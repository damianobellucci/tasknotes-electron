const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.TABLE_NAME;
const SHARED_API_KEY = process.env.SHARED_API_KEY;
const AUTH_MODE = String(process.env.AUTH_MODE || 'hybrid').toLowerCase();

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'OPTIONS,GET,POST',
      'access-control-allow-headers': 'content-type,x-api-key'
    },
    body: JSON.stringify(payload)
  };
}

function getMethod(event) {
  return event?.requestContext?.http?.method || event?.httpMethod || '';
}

function getPath(event) {
  const rawPath = event?.rawPath || event?.path || '';
  return String(rawPath);
}

function getApiKey(event) {
  const headers = event?.headers || {};
  return headers['x-api-key'] || headers['X-Api-Key'] || headers['X-API-KEY'] || '';
}

function getCognitoUserId(event) {
  const authorizer = event?.requestContext?.authorizer || {};

  // HTTP API JWT authorizer shape.
  const jwtSub = authorizer?.jwt?.claims?.sub;
  if (jwtSub) {
    return String(jwtSub);
  }

  // REST API Cognito authorizer shape.
  const claimsSub = authorizer?.claims?.sub;
  if (claimsSub) {
    return String(claimsSub);
  }

  const principalId = authorizer?.principalId;
  if (principalId) {
    return String(principalId);
  }

  return '';
}

function getPkValue(userId) {
  return `user#${String(userId || '').trim()}`;
}

function resolveAuth(event) {
  const cognitoUserId = getCognitoUserId(event);
  const apiKey = getApiKey(event);

  if (AUTH_MODE === 'cognito') {
    if (!cognitoUserId) {
      return { ok: false, error: 'Missing or invalid Cognito identity' };
    }
    return { ok: true, userId: cognitoUserId, authType: 'cognito' };
  }

  if (AUTH_MODE === 'shared') {
    if (!apiKey || apiKey !== SHARED_API_KEY) {
      return { ok: false, error: 'Invalid API key' };
    }
    return { ok: true, userId: 'shared', authType: 'shared' };
  }

  // Hybrid mode: prefer Cognito and keep shared key as fallback during migration.
  if (cognitoUserId) {
    return { ok: true, userId: cognitoUserId, authType: 'cognito' };
  }

  if (apiKey && apiKey === SHARED_API_KEY) {
    return { ok: true, userId: 'shared', authType: 'shared' };
  }

  return { ok: false, error: 'Unauthorized' };
}

function parseBody(event) {
  if (!event?.body) {
    return {};
  }

  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

async function readSnapshot(userId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: getPkValue(userId) }
    })
  );

  return result.Item || null;
}

async function writeSnapshot(userId, snapshot, clientUpdatedAt, baseServerUpdatedAt) {
  const current = await readSnapshot(userId);
  const currentServerUpdatedAt = current?.serverUpdatedAt || '';

  if (current && currentServerUpdatedAt !== (baseServerUpdatedAt || '')) {
    return {
      ok: false,
      conflict: true,
      snapshot: current.snapshot || null,
      serverUpdatedAt: currentServerUpdatedAt
    };
  }

  const serverUpdatedAt = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: getPkValue(userId),
        snapshot,
        userId,
        clientUpdatedAt: clientUpdatedAt || null,
        serverUpdatedAt
      }
    })
  );

  return {
    ok: true,
    serverUpdatedAt
  };
}

function isMissingConfig() {
  if (!TABLE_NAME) {
    return true;
  }

  if (AUTH_MODE === 'shared' || AUTH_MODE === 'hybrid') {
    return !SHARED_API_KEY;
  }

  return false;
}

exports.handler = async (event) => {
  if (isMissingConfig()) {
    return json(500, { ok: false, error: 'Missing required auth environment configuration' });
  }

  const method = getMethod(event);
  const path = getPath(event);

  if (method === 'OPTIONS') {
    return json(200, { ok: true });
  }

  const auth = resolveAuth(event);
  if (!auth.ok) {
    return json(401, { ok: false, error: auth.error || 'Unauthorized' });
  }
  const userId = auth.userId;

  try {
    if (method === 'POST' && path.endsWith('/sync/push')) {
      const body = parseBody(event);
      if (!body) {
        return json(400, { ok: false, error: 'Invalid JSON payload' });
      }

      const { snapshot, clientUpdatedAt, baseServerUpdatedAt } = body;
      if (!snapshot || typeof snapshot !== 'object') {
        return json(400, { ok: false, error: 'Missing snapshot object' });
      }

      const writeResult = await writeSnapshot(userId, snapshot, clientUpdatedAt, baseServerUpdatedAt);
      if (writeResult.conflict) {
        return json(409, {
          ok: false,
          conflict: true,
          error: 'Sync conflict',
          snapshot: writeResult.snapshot,
          serverUpdatedAt: writeResult.serverUpdatedAt,
          authType: auth.authType
        });
      }

      return json(200, { ok: true, serverUpdatedAt: writeResult.serverUpdatedAt, authType: auth.authType });
    }

    if (method === 'GET' && path.endsWith('/sync/pull')) {
      const since = event?.queryStringParameters?.since || '';
      const item = await readSnapshot(userId);

      if (!item) {
        return json(200, { ok: true, snapshot: null, serverUpdatedAt: null });
      }

      const serverUpdatedAt = item.serverUpdatedAt || null;
      if (since && serverUpdatedAt && since >= serverUpdatedAt) {
        return json(200, { ok: true, snapshot: null, serverUpdatedAt });
      }

      return json(200, {
        ok: true,
        snapshot: item.snapshot || null,
        serverUpdatedAt,
        authType: auth.authType
      });
    }

    return json(404, { ok: false, error: 'Route not found' });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error?.message || 'Internal server error'
    });
  }
};
