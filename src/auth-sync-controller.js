(function attachAuthSyncController(global) {
  function create(deps) {
    const {
      state,
      refs,
      electronAPI,
      cloudSyncIntervalMs,
      hasUnsyncedLocalChanges,
      getSerializableState,
      persistStateToDisk,
      cloneSnapshot,
      mergeSnapshots,
      applyLoadedData,
      render,
      showToast,
      setStatus,
      formatDate
    } = deps;

    async function initAuth() {
      try {
        const status = await electronAPI.getCloudSyncStatus();
        if (!status?.cognitoConfigured) {
          await initCloudSync();
          return;
        }

        const authStatus = await electronAPI.authGetStatus();
        if (authStatus?.loggedIn) {
          state.authLoggedIn = true;
          state.authEmail = authStatus.email || '';
          updateAuthUI();
          await initCloudSync();
        } else {
          openLoginModal();
        }
      } catch {
        await initCloudSync();
      }
    }

    function openLoginModal() {
      refs.loginModal.classList.add('visible');
      refs.loginModal.setAttribute('aria-hidden', 'false');
      refs.loginError.textContent = '';
      refs.loginEmailInput.value = '';
      refs.loginPasswordInput.value = '';
      refs.loginNewPasswordRow.style.display = 'none';
      refs.loginNewPasswordInput.value = '';
      refs.loginSubmitButton.textContent = 'Accedi';
      state._loginSession = null;
      setTimeout(() => refs.loginEmailInput.focus(), 50);
    }

    function closeLoginModal() {
      refs.loginModal.classList.remove('visible');
      refs.loginModal.setAttribute('aria-hidden', 'true');
    }

    async function onLoginSubmit() {
      if (state._loginSession) {
        await onNewPasswordSubmit();
        return;
      }

      const email = refs.loginEmailInput.value.trim();
      const password = refs.loginPasswordInput.value;
      if (!email || !password) {
        refs.loginError.textContent = 'Inserisci email e password.';
        return;
      }

      refs.loginSubmitButton.disabled = true;
      refs.loginSubmitButton.textContent = 'Accesso…';
      refs.loginError.textContent = '';

      try {
        const result = await electronAPI.authLogin(email, password);
        if (result?.newPasswordRequired) {
          state._loginSession = result.session;
          state._loginEmail = result.email;
          refs.loginNewPasswordRow.style.display = 'flex';
          refs.loginNewPasswordInput.focus();
          refs.loginError.textContent = 'Primo accesso: imposta una nuova password permanente.';
          refs.loginSubmitButton.textContent = 'Imposta password';
          return;
        }
        if (!result?.ok) {
          refs.loginError.textContent = result?.error || 'Login fallito.';
          return;
        }
        await onLoginSuccess(result.email || email);
      } finally {
        refs.loginSubmitButton.disabled = false;
        if (!state._loginSession) refs.loginSubmitButton.textContent = 'Accedi';
      }
    }

    async function onNewPasswordSubmit() {
      const newPassword = refs.loginNewPasswordInput.value;
      if (!newPassword || newPassword.length < 8) {
        refs.loginError.textContent = 'La password deve essere di almeno 8 caratteri.';
        return;
      }
      refs.loginSubmitButton.disabled = true;
      refs.loginSubmitButton.textContent = 'Salvataggio…';
      refs.loginError.textContent = '';
      try {
        const result = await electronAPI.authNewPassword(state._loginEmail, newPassword, state._loginSession);
        if (!result?.ok) {
          refs.loginError.textContent = result?.error || 'Errore cambio password.';
          return;
        }
        state._loginSession = null;
        await onLoginSuccess(result.email || state._loginEmail);
      } finally {
        refs.loginSubmitButton.disabled = false;
      }
    }

    async function onLoginSuccess(email) {
      state.authLoggedIn = true;
      state.authEmail = email;
      updateAuthUI();
      closeLoginModal();
      if (state.cloudSyncTimer) clearInterval(state.cloudSyncTimer);
      await initCloudSync();
      setStatus(`Connesso come ${email}`);
    }

    async function onLogout() {
      if (hasUnsyncedLocalChanges()) {
        const confirmed = global.confirm(
          'Hai modifiche locali non ancora sincronizzate con il cloud.\nSe esci ora andranno perse. Continuare?'
        );
        if (!confirmed) return;
      }

      await electronAPI.authLogout();
      state.authLoggedIn = false;
      state.authEmail = '';
      state.cloudSyncEnabled = false;
      clearCloudRetry();
      if (state.cloudSyncTimer) {
        clearInterval(state.cloudSyncTimer);
        state.cloudSyncTimer = null;
      }
      state.tasks = [];
      state.notes = [];
      state.tags = [];
      state.deletedSnapshot = null;
      state.cloudServerUpdatedAt = '';
      state.cloudBaseSnapshot = null;
      state.cloudLastSnapshotHash = '';
      state.cloudLastSyncAt = '';
      await persistStateToDisk();
      render();
      updateAuthUI();
      setStatus('Disconnesso');
    }

    function updateAuthUI() {
      if (refs.loginButton) refs.loginButton.style.display = state.authLoggedIn ? 'none' : 'inline-flex';
      if (refs.logoutButton) {
        refs.logoutButton.style.display = state.authLoggedIn ? 'inline-flex' : 'none';
        refs.logoutButton.textContent = state.authEmail ? `Logout (${state.authEmail})` : 'Logout';
      }
    }

    async function initCloudSync() {
      try {
        const status = await electronAPI.getCloudSyncStatus();
        state.cloudSyncEnabled = Boolean(status?.enabled) && (!status?.cognitoConfigured || state.authLoggedIn);

        if (!state.cloudSyncEnabled) {
          return;
        }

        await pullFromCloud();
        const localSnapshot = getSerializableState();
        if (hasUnsyncedLocalChanges(localSnapshot)) {
          queueCloudPush(localSnapshot);
        }
        state.cloudSyncTimer = setInterval(() => {
          pullFromCloud();
        }, cloudSyncIntervalMs);
      } catch {
        state.cloudSyncEnabled = false;
      }
    }

    function queueCloudPush(payload) {
      if (!state.cloudSyncEnabled) {
        return;
      }

      const snapshot = payload || getSerializableState();
      const snapshotHash = JSON.stringify(snapshot);
      if (snapshotHash === state.cloudLastSnapshotHash) {
        return;
      }

      void pushToCloud(snapshot, snapshotHash);
    }

    async function pushToCloud(snapshot, snapshotHash, baseServerUpdatedAt = state.cloudServerUpdatedAt || '') {
      if (state.cloudSyncInFlight) {
        state.cloudSyncPendingPush = true;
        return;
      }

      state.cloudSyncInFlight = true;
      try {
        const result = await electronAPI.cloudPush({
          snapshot,
          clientUpdatedAt: new Date().toISOString(),
          baseServerUpdatedAt
        });

        if (result?.conflict && result?.snapshot) {
          await resolveCloudConflict(snapshot, snapshotHash, result.snapshot, result.serverUpdatedAt || '');
          return;
        }

        if (!result?.ok) {
          const retryDelayMs = result?.status === 429 ? 5000 : 15000;
          setStatus(result?.status === 429 ? 'Cloud sync throttled, retrying soon...' : `Cloud sync pending: ${result?.error || 'push failed'}`);
          scheduleCloudRetry(retryDelayMs);
          return;
        }

        clearCloudRetry();
        state.cloudLastSnapshotHash = snapshotHash;
        state.cloudBaseSnapshot = cloneSnapshot(snapshot);
        state.cloudServerUpdatedAt = result.serverUpdatedAt || '';
        state.cloudLastSyncAt = result.serverUpdatedAt || result.syncedAt || new Date().toISOString();
        await persistStateToDisk();
        setCloudSyncedStatus();
      } catch (error) {
        setStatus(`Cloud sync pending: ${error.message}`);
        scheduleCloudRetry(15000);
      } finally {
        state.cloudSyncInFlight = false;

        if (state.cloudSyncPendingPush) {
          state.cloudSyncPendingPush = false;
          const nextSnapshot = getSerializableState();
          void pushToCloud(nextSnapshot, JSON.stringify(nextSnapshot));
        }
      }
    }

    async function pullFromCloud() {
      if (!state.cloudSyncEnabled || state.cloudSyncInFlight || state.saveInFlight) {
        return;
      }

      state.cloudSyncInFlight = true;
      try {
        const result = await electronAPI.cloudPull({ since: state.cloudServerUpdatedAt || '' });
        if (!result?.ok) {
          if (result?.status === 429) {
            setStatus('Cloud sync throttled, retrying later...');
          }
          return;
        }

        const remoteData = result.snapshot || result.data;
        if (!remoteData) {
          return;
        }

        const remoteHash = JSON.stringify(remoteData);
        const localHash = JSON.stringify(getSerializableState());
        if (remoteHash === localHash) {
          state.cloudBaseSnapshot = cloneSnapshot(remoteData);
          state.cloudServerUpdatedAt = result.serverUpdatedAt || '';
          state.cloudLastSnapshotHash = remoteHash;
          state.cloudLastSyncAt = result.serverUpdatedAt || result.syncedAt || state.cloudLastSyncAt;
          await persistStateToDisk();
          return;
        }

        if (!state.cloudBaseSnapshot) {
          state.cloudBaseSnapshot = cloneSnapshot(remoteData);
          state.cloudServerUpdatedAt = result.serverUpdatedAt || '';
          state.cloudLastSnapshotHash = remoteHash;
          state.cloudLastSyncAt = result.serverUpdatedAt || result.syncedAt || state.cloudLastSyncAt;
          applyLoadedData({
            ...remoteData,
            sync: { serverUpdatedAt: state.cloudServerUpdatedAt, lastSyncedSnapshot: state.cloudBaseSnapshot }
          });
          await persistStateToDisk();
          render();
          return;
        }

        const mergeResult = mergeSnapshots(state.cloudBaseSnapshot, getSerializableState(), remoteData);
        state.cloudBaseSnapshot = cloneSnapshot(remoteData);
        state.cloudServerUpdatedAt = result.serverUpdatedAt || '';
        state.cloudLastSnapshotHash = remoteHash;
        applyLoadedData({
          ...mergeResult.snapshot,
          sync: {
            serverUpdatedAt: state.cloudServerUpdatedAt,
            lastSyncedSnapshot: state.cloudBaseSnapshot
          }
        });
        await persistStateToDisk();
        render();
        if (mergeResult.conflicts > 0) {
          showToast(`Cloud conflict merged: kept ${mergeResult.conflicts} duplicate ${mergeResult.conflicts === 1 ? 'copy' : 'copies'}`, false);
          setStatus('Cloud conflict merged locally, sync pending');
          queueCloudPush(mergeResult.snapshot);
          return;
        }

        if (hasUnsyncedLocalChanges(mergeResult.snapshot)) {
          setStatus('Cloud changes merged locally, sync pending');
          queueCloudPush(mergeResult.snapshot);
          return;
        }

        state.cloudLastSyncAt = result.serverUpdatedAt || result.syncedAt || new Date().toISOString();
        setCloudSyncedStatus();
      } catch {
        // Keep local app fully usable even when cloud is unavailable.
      } finally {
        state.cloudSyncInFlight = false;
      }
    }

    async function resolveCloudConflict(localSnapshot, _snapshotHash, remoteSnapshot, serverUpdatedAt) {
      const mergeResult = mergeSnapshots(state.cloudBaseSnapshot, localSnapshot, remoteSnapshot);

      state.cloudBaseSnapshot = cloneSnapshot(remoteSnapshot);
      state.cloudServerUpdatedAt = serverUpdatedAt || '';
      state.cloudLastSnapshotHash = JSON.stringify(remoteSnapshot);
      applyLoadedData({
        ...mergeResult.snapshot,
        sync: {
          serverUpdatedAt: state.cloudServerUpdatedAt,
          lastSyncedSnapshot: state.cloudBaseSnapshot
        }
      });
      await persistStateToDisk();
      render();

      if (mergeResult.conflicts > 0) {
        showToast(`Cloud conflict merged: kept ${mergeResult.conflicts} duplicate ${mergeResult.conflicts === 1 ? 'copy' : 'copies'}`, false);
      }

      setStatus('Cloud conflict merged locally, retrying sync...');
      const mergedSnapshotHash = JSON.stringify(mergeResult.snapshot);
      await pushToCloud(mergeResult.snapshot, mergedSnapshotHash, state.cloudServerUpdatedAt || '');
    }

    function clearCloudRetry() {
      if (!state.cloudRetryTimer) {
        return;
      }

      clearTimeout(state.cloudRetryTimer);
      state.cloudRetryTimer = null;
    }

    function scheduleCloudRetry(delayMs) {
      if (!state.cloudSyncEnabled) {
        return;
      }

      clearCloudRetry();
      state.cloudRetryTimer = setTimeout(() => {
        state.cloudRetryTimer = null;
        const snapshot = getSerializableState();
        void pushToCloud(snapshot, JSON.stringify(snapshot));
      }, delayMs);
    }

    function setCloudSyncedStatus() {
      const formattedSyncTime = formatDate(state.cloudLastSyncAt);
      setStatus(formattedSyncTime === '-' ? 'Cloud sincronizzato' : `Cloud sincronizzato ${formattedSyncTime}`);
    }

    return {
      initAuth,
      openLoginModal,
      closeLoginModal,
      onLoginSubmit,
      onNewPasswordSubmit,
      onLoginSuccess,
      onLogout,
      updateAuthUI,
      initCloudSync,
      queueCloudPush,
      pushToCloud,
      pullFromCloud,
      resolveCloudConflict,
      clearCloudRetry,
      scheduleCloudRetry
    };
  }

  global.TaskNotesAuthSyncController = { create };
}(window));