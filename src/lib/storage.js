/**
 * SumVid - Chrome Storage Wrapper
 * Abstraction over chrome.storage for settings and prompt templates.
 * Uses storage.sync for cross-device sync where possible.
 */

const STORAGE_KEYS = {
  PROMPT_TEMPLATES: 'promptTemplates',
  ACTIVE_TEMPLATE: 'activeTemplate',
  SETTINGS: 'settings',
};

const DEFAULT_SETTINGS = {
  defaultAI: 'claude',
  panelAutoOpen: false,
  panelPosition: 'right',
  showTimestamps: true,
  includeMetadata: true,
  language: 'auto',
};

/**
 * Get a value from chrome.storage.sync (falls back to local)
 * @param {string} key
 * @param {*} defaultValue
 * @returns {Promise<*>}
 */
export async function get(key, defaultValue = null) {
  try {
    const result = await chrome.storage.sync.get(key);
    return result[key] ?? defaultValue;
  } catch {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? defaultValue;
  }
}

/**
 * Set a value in chrome.storage.sync (falls back to local)
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function set(key, value) {
  try {
    await chrome.storage.sync.set({ [key]: value });
  } catch {
    await chrome.storage.local.set({ [key]: value });
  }
}

/**
 * Remove a key from storage
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function remove(key) {
  try {
    await chrome.storage.sync.remove(key);
  } catch {
    await chrome.storage.local.remove(key);
  }
}

/**
 * Get all prompt templates
 * @returns {Promise<Object>}
 */
export async function getPromptTemplates() {
  return get(STORAGE_KEYS.PROMPT_TEMPLATES, {});
}

/**
 * Save a prompt template
 * @param {string} id - Template ID
 * @param {Object} template - { name, icon, prompt }
 * @returns {Promise<void>}
 */
export async function savePromptTemplate(id, template) {
  const templates = await getPromptTemplates();
  const updated = { ...templates, [id]: template };
  await set(STORAGE_KEYS.PROMPT_TEMPLATES, updated);
}

/**
 * Delete a prompt template
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deletePromptTemplate(id) {
  const templates = await getPromptTemplates();
  const { [id]: _, ...rest } = templates;
  await set(STORAGE_KEYS.PROMPT_TEMPLATES, rest);
}

/**
 * Get the active template ID
 * @returns {Promise<string>}
 */
export async function getActiveTemplate() {
  return get(STORAGE_KEYS.ACTIVE_TEMPLATE, 'summary');
}

/**
 * Set the active template ID
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function setActiveTemplate(id) {
  await set(STORAGE_KEYS.ACTIVE_TEMPLATE, id);
}

/**
 * Get extension settings
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const saved = await get(STORAGE_KEYS.SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

/**
 * Update extension settings (partial merge)
 * @param {Object} partial - Settings to update
 * @returns {Promise<void>}
 */
export async function updateSettings(partial) {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await set(STORAGE_KEYS.SETTINGS, updated);
}

export { STORAGE_KEYS, DEFAULT_SETTINGS };
