import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../services/api';
import {
  DEFAULT_MODULE_VISIBILITY,
  normalizeModuleSettings,
  serializeModuleSettings,
} from '../config/modules';
import { ModuleSettingsContext } from './moduleSettingsStore';

export function ModuleSettingsProvider({ children }) {
  const [modules, setModules] = useState(DEFAULT_MODULE_VISIBILITY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshModuleSettings = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await API.getModuleSettings();
      const normalized = normalizeModuleSettings(response);
      setModules(normalized);
      return normalized;
    } catch (loadError) {
      const normalized = normalizeModuleSettings(DEFAULT_MODULE_VISIBILITY);
      setModules(normalized);
      setError(loadError?.message || 'Module settings could not be loaded.');
      return normalized;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveModuleSettings = useCallback(async (nextModules) => {
    setError('');
    const response = await API.updateModuleSettings(serializeModuleSettings(nextModules));
    const normalized = normalizeModuleSettings(response);
    setModules(normalized);
    return normalized;
  }, []);

  useEffect(() => {
    refreshModuleSettings();
  }, [refreshModuleSettings]);

  const value = useMemo(
    () => ({
      modules,
      loading,
      error,
      refreshModuleSettings,
      saveModuleSettings,
      setModules,
    }),
    [error, loading, modules, refreshModuleSettings, saveModuleSettings]
  );

  return (
    <ModuleSettingsContext.Provider value={value}>
      {children}
    </ModuleSettingsContext.Provider>
  );
}
