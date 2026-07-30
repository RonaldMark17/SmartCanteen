import { useContext } from 'react';
import { DEFAULT_MODULE_VISIBILITY } from '../config/modules';
import { ModuleSettingsContext } from './moduleSettingsStore';

export function useModuleSettings() {
  const value = useContext(ModuleSettingsContext);

  if (value) {
    return value;
  }

  return {
    modules: DEFAULT_MODULE_VISIBILITY,
    loading: false,
    error: '',
    refreshModuleSettings: async () => DEFAULT_MODULE_VISIBILITY,
    saveModuleSettings: async () => DEFAULT_MODULE_VISIBILITY,
    setModules: () => {},
  };
}
