'use strict';

// ============================================================
// 0. LOGGER (single source of truth for all debug output)
// ============================================================

/**
 * Log message to console and optionally send to popup
 * Automatically captures line number and function name for debugging
 * @param {string} msg - Message to log
 * @param {*} [data] - Optional extra data/object/error to log alongside msg
 */
function log(msg, data) {
  const stack = new Error().stack;
  const callerLine = stack.split('\n')[2] || '';
  const match = callerLine.match(/at\s+(.+?)\s+\(.*:(\d+):\d+\)/) ||
    callerLine.match(/at\s+.*:(\d+):\d+/);
  let lineInfo = '';
  if (match) {
    const functionName = match[1] || 'anonymous';
    const lineNumber = match[2] || match[1];
    lineInfo = ` [${functionName}:${lineNumber}]`;
  }
  if (data !== undefined) {
    console.log(`[Mohammad Tanvir's Bot]${lineInfo}`, msg, data);
  } else {
    console.log(`[Mohammad Tanvir's Bot]${lineInfo}`, msg);
  }
  try {
    chrome.runtime.sendMessage({ type: 'log', message: msg });
  } catch (e) {
    // Popup not available, silently continue
  }
}

// ============================================================
// 1. CONFIGURATION
// ============================================================

const CONFIG = {
  SELECTORS: {
    commentBox: ['[componentkey^="commentBox-"]', '[data-testid="comment-box"]', '.comment-box'],
    commentEditor: ['[contenteditable="true"][role="textbox"]', '.ProseMirror', 'textarea'],
    commentToolbar: ['[data-testid="ui-core-tiptap-text-editor-wrapper"] ~ div', '.ql-toolbar', 'div[role="toolbar"]'],
    postContainer: ['[role="listitem"]', '[data-testid="feed-post"]', 'article', '.feed-shared-update-v2'],
    postText: ['[data-testid="expandable-text-box"]', '.feed-shared-text', '.break-words'],
    authorLabel: ['figure[aria-label]', 'a[aria-label]', '[data-testid="feed-identity-label"]'],
    commentItem: ['[componentkey*="replaceableComment"]', '[data-testid="comment-item"]', '.comment-item'],
    postEditor: ['[data-test-ql-editor-contenteditable="true"]', '[aria-label="Text editor for creating content"]', '.ql-editor'],
    shadowHost: '#interop-outlet',
  },

  FALLBACK_MODELS: {
    groq: ['llama-4-maverick-17b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    openai: ['gpt-4o-mini'],
    gemini: ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash'],
  },

  PROMPTS: {
    comment: `You are an assistant that writes replies to LinkedIn posts. Use same language, sound human, friendly, no hashtags, use occasional emojis, keep it brief, positive and add value. Mention author only if individual, not company.`,
    post: `You are an expert LinkedIn creator. Use same language, sound authentic, use a scroll-stopping hook (1-2 lines), short paragraphs, natural emojis, 3-5 tags at the end. Keep plain text, 100-220 words, no markdown.`,
  },

  TIMEOUTS: {
    scanDebounce: 200,
    backupInterval: 5000,
    overlayFocusDelay: 50,
  },

  ENDPOINTS: {
    groq: {
      chat: 'https://api.groq.com/openai/v1/chat/completions',
      models: 'https://api.groq.com/openai/v1/models',
    },
    openai: {
      chat: 'https://api.openai.com/v1/chat/completions',
      models: 'https://api.openai.com/v1/models',
    },
    gemini: {
      chat: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      models: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    },
  },
};

// ============================================================
// 2. UTILITIES
// ============================================================

const Utils = {
  findElements(container, selectors, context = 'unknown', single = true) {
    for (const sel of selectors) {
      const found = single ? container.querySelector(sel) : Array.from(container.querySelectorAll(sel));
      if (found && (!single ? found.length : true)) {
        log(`🔍 Selector "${sel}" matched in ${context}`);
        return found;
      }
    }
    log(`⚠️ No selectors matched in ${context}`);
    return single ? null : [];
  },

  async safeFetch(url, options, context = 'API call') {
    try {
      log(`🔍 Fetching ${url}`);
      const res = await fetch(url, options);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 100)}`);
      }
      const data = await res.json();
      log(`🔍 Request succeeded for ${context}`);
      return data;
    } catch (err) {
      log(`❌ Request failed in ${context}:`, err.message);
      return null;
    }
  },

  debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  // Strip basic markdown syntax
  stripMarkdown(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/^#{1,6}\s+(.+)$/gm, '$1')
      .replace(/^[\*\-\+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim();
  },

  // Remove all emoji characters (including skin tone modifiers)
  removeEmojis(text) {
    // Unicode emoji regex pattern – covers most emojis and modifiers
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F1E0}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu;
    return text.replace(emojiRegex, '').trim();
  },
};

// ============================================================
// 3. CONFIGURATION STORAGE
// ============================================================


const ConfigStorage = {
  _warnedNoKey: false,

  async get() {
    try {
      const data = await chrome.storage.sync.get(['apiKey', 'apiProvider']);
      log('🔍 Storage loaded', data);
      if (!data.apiKey) {
        log('⚠️ No API key found. Please set it in the popup.');
        if (!this._warnedNoKey) {
          this._warnedNoKey = true;
          alert('Please set your API key in the extension popup.');
        }
        return null;
      }
      return {
        apiKey: data.apiKey,
        provider: data.apiProvider || 'groq',
      };
    } catch (err) {
      log('❌ Error loading storage:', err.message);
      return null;
    }
  },
};


// ============================================================
// 4. DOM EXTRACTION
// ============================================================

const DomExtractor = {
  extractAuthor(el) {
    if (!el) return null;

    // 1. Try extracting from aria-label first
    const label = el.getAttribute('aria-label') || '';
    if (label) {
      // Matches both straight (') and curly (’) quotes directly in the regex
      const match = label.match(/^View (?:company: )?(.+?)(?:['’]s profile.*)?$/i);
      if (match) {
        return match[1].trim();
      }
    }

    // 2. Fallback: If aria-label is translated or missing, read the visible inner text
    const visibleText = el.innerText?.trim();
    if (visibleText && visibleText.length > 0 && visibleText.length < 60) {
      // Filter out multiline text (e.g., if we grabbed a whole header card by mistake)
      if (!visibleText.includes('\n')) {
        return visibleText;
      }
    }

    return null;
  },

  findPost(commentBox) {
    // Search directly upwards for any selector that represents a LinkedIn post container
    const postSelectors = CONFIG.SELECTORS.postContainer.join(',');
    const post = commentBox.closest(postSelectors);

    if (post) {
      log('✅ Parent post container found directly:', post);
      return post;
    }

    log('ℹ️ Direct post container not found. Searching document...');
    return Utils.findElements(document, CONFIG.SELECTORS.postContainer, 'findPost', true);
  },

  extractPostContext(commentBox) {
    const post = this.findPost(commentBox);
    if (!post) {
      log(`⚠️ Could not find parent post`);
      return { author: 'Someone', text: '' };
    }
    const authorEl = Utils.findElements(post, CONFIG.SELECTORS.authorLabel, 'extractAuthor', true);
    const author = this.extractAuthor(authorEl) || 'Someone';
    const textEl = Utils.findElements(post, CONFIG.SELECTORS.postText, 'extractText', true);
    const text = textEl?.innerText || '';
    return { author, text };
  },

  extractReplyContext(commentBox) {
    const parent = commentBox.closest(CONFIG.SELECTORS.commentItem.join(','));
    if (!parent) return null;
    const authorEl = parent.querySelector(CONFIG.SELECTORS.authorLabel.join(','));
    const author = this.extractAuthor(authorEl) || 'A user';
    const textEl = parent.querySelector('[data-testid="expandable-text-box"], .comment__content');
    const text = textEl?.innerText || '';
    return { author, text };
  },

  buildCommentPrompt(commentBox) {
    const post = this.extractPostContext(commentBox);
    let prompt = `${post.author} wrote: ${post.text}`;
    const reply = this.extractReplyContext(commentBox);
    if (reply) {
      prompt += `\n${reply.author} replied: ${reply.text}`;
      prompt += `\nPlease write a reply to the reply with a maximum of 20 words.`;
    } else {
      prompt += `\nPlease write a reply to this post with a maximum of 60 words.`;
    }
    log(`📝 Built comment prompt:`, prompt);
    return prompt;
  },
};

// ============================================================
// 5. AI SERVICE
// ============================================================

const AIService = {
  _modelCache: {},

  /** Clear cached models when the user updates key/provider in the popup — avoids stale-model bugs. */
  _initCacheInvalidation() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && (changes.apiKey || changes.apiProvider)) {
          log('⚙️ Config changed — clearing model cache');
          this._modelCache = {};
        }
      });
    } catch (e) {
      log('⚠️ Could not attach storage.onChanged listener', e.message);
    }
  },

  async _fetchModels(provider, apiKey) {
    if (this._modelCache[provider]) return this._modelCache[provider];

    let url, options = { headers: { 'Content-Type': 'application/json' } };
    let transformFn;

    if (provider === 'groq') {
      url = CONFIG.ENDPOINTS.groq.models;
      options.headers['Authorization'] = `Bearer ${apiKey}`;
      transformFn = (data) => data.data?.map(m => m.id) || [];
    } else if (provider === 'openai') {
      url = CONFIG.ENDPOINTS.openai.models;
      options.headers['Authorization'] = `Bearer ${apiKey}`;
      transformFn = (data) => data.data?.map(m => m.id) || [];
    } else if (provider === 'gemini') {
      url = CONFIG.ENDPOINTS.gemini.models(apiKey);
      transformFn = (data) => data.models
        ?.filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', '')) || [];
    } else {
      return CONFIG.FALLBACK_MODELS[provider] || [];
    }

    const data = await Utils.safeFetch(url, options, `Fetch ${provider} models`);
    if (data) {
      let models = transformFn(data);
      if (provider === 'gemini') {
        models.sort((a, b) => {
          const score = (n) => n.includes('lite') ? 1 : n.includes('flash') ? 2 : n.includes('pro') ? 3 : 4;
          return score(a) - score(b);
        });
      }
      if (models.length > 0) {
        this._modelCache[provider] = models;
        log(`✅ Fetched ${models.length} models for ${provider}:`, models);
        return models;
      }
    }

    log(`⚠️ Using fallback models for ${provider}`);
    const fallback = CONFIG.FALLBACK_MODELS[provider] || [];
    this._modelCache[provider] = fallback;
    return fallback;
  },

  async fetchContent(prompt, systemPrompt = CONFIG.PROMPTS.comment, maxTokens = 256) {
    const config = await ConfigStorage.get();
    if (!config?.apiKey) return '';

    const { apiKey, provider } = config;
    log(`🚀 Using provider: ${provider}`);

    const isOpenAICompatible = provider === 'groq' || provider === 'openai';
    const models = await this._fetchModels(provider, apiKey);
    if (models.length === 0) {
      log(`❌ No models available for provider ${provider}`);
      return '';
    }

    for (const model of models) {
      try {
        log(`🔄 Trying model: ${model}`);
        let url, headers = { 'Content-Type': 'application/json' };
        let body;

        if (provider === 'groq') {
          url = CONFIG.ENDPOINTS.groq.chat;
          headers['Authorization'] = `Bearer ${apiKey}`;
          body = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt },
            ],
            temperature: 1,
            max_tokens: maxTokens,
            top_p: 0.7,
            frequency_penalty: 2,
            presence_penalty: 2,
          };
        } else if (provider === 'openai') {
          url = CONFIG.ENDPOINTS.openai.chat;
          headers['Authorization'] = `Bearer ${apiKey}`;
          body = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt },
            ],
            temperature: 1,
            max_tokens: maxTokens,
            top_p: 0.7,
            frequency_penalty: 2,
            presence_penalty: 2,
          };
        } else if (provider === 'gemini') {
          url = CONFIG.ENDPOINTS.gemini.chat(model, apiKey);
          body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 1,
              topP: 0.7,
              maxOutputTokens: maxTokens,
            },
          };
        } else {
          throw new Error(`Unsupported provider: ${provider}`);
        }

        log(`📝 Sending prompt to ${model}:`, prompt);

        const data = await Utils.safeFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, `Call ${model}`);
        if (!data) continue;

        let content;
        if (isOpenAICompatible) {
          content = data?.choices?.[0]?.message?.content;
        } else {
          content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        if (content?.trim()) {
          // Clean: strip markdown and remove emojis
          let plain = Utils.stripMarkdown(content.trim());
          plain = Utils.removeEmojis(plain);
          log(`📤 Response from ${model}:`, plain);
          return plain;
        } else {
          log(`⚠️ Empty or invalid response from ${model}`);
        }
      } catch (err) {
        log(`❌ Error with model ${model}:`, err.message);
      }
    }

    log(`❌ All models for ${provider} failed.`);
    return '';
  },

  async fetchCommentReply(prompt) {
    return this.fetchContent(prompt, CONFIG.PROMPTS.comment, 256);
  },

  async fetchPost(topic) {
    const prompt = `Write a ready-to-publish LinkedIn post about:\n"${topic}"`;
    return this.fetchContent(prompt, CONFIG.PROMPTS.post, 700);
  },
};

// ============================================================
// 6. EDITOR HANDLER
// ============================================================

const EditorHandler = {
  insertText(editor, text) {
    if (!editor) {
      log(`❌ Editor element is null`);
      return false;
    }

    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false);

    const htmlContent = text.split('\n').map(line => line || '').join('<br>');
    let success = document.execCommand('insertHTML', false, htmlContent);

    if (!success || !editor.textContent.trim()) {
      log(`⚠️ insertHTML incomplete, falling back to innerHTML`);
      editor.innerHTML = text.split('\n').map(l => l.trim() ? `<p>${l}</p>` : '<p><br></p>').join('');
      success = true;
    }

    editor.classList.remove('ql-blank');
    ['input', 'change', 'keyup'].forEach(evtType => {
      editor.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true }));
      editor.dispatchEvent(new InputEvent(evtType, { bubbles: true, cancelable: true, composed: true }));
    });

    log(`✅ Text inserted into editor`);
    return true;
  },
};

// ============================================================
// 7. UI INJECTION
// ============================================================

const UIInjector = {
  createCommentButton(commentBox, editor) {
    if (commentBox.hasAttribute('data-ai-mutated')) return;
    commentBox.setAttribute('data-ai-mutated', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'artdeco-button artdeco-button--muted artdeco-button--tertiary artdeco-button--circle';
    btn.title = 'AI Suggestion';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/></svg>`;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      log(`🖱️ Comment AI button clicked`);
      const prompt = DomExtractor.buildCommentPrompt(commentBox);
      const reply = await AIService.fetchCommentReply(prompt);
      if (reply) {
        EditorHandler.insertText(editor, reply);
      } else {
        log(`❌ No reply generated`);
      }
    });

    const toolbar = Utils.findElements(commentBox, CONFIG.SELECTORS.commentToolbar, 'commentToolbar', true);
    if (toolbar) {
      toolbar.prepend(btn);
    } else if (editor.parentElement) {
      editor.parentElement.appendChild(btn);
    }
  },

  createPostButton(editor) {
    const container = editor.closest('.editor-container') || editor.parentElement;
    if (!container || container.querySelector('[data-ai-post-btn="true"]')) return;

    if (window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-ai-post-btn', 'true');
    btn.style.cssText = 'position:absolute; top:10px; right:10px; z-index:100; display:inline-flex; align-items:center; gap:6px; background:#0a66c2; color:#fff; border:none; border-radius:16px; padding:6px 14px; font-size:13px; font-weight:600; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.2);';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/></svg><span>AI Post</span>`;

    btn.onmouseover = () => btn.style.backgroundColor = '#004182';
    btn.onmouseout = () => btn.style.backgroundColor = '#0a66c2';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      log(`🖱️ Post AI button clicked`);
      const topic = await this._promptForTopic(editor);
      if (!topic) return;

      btn.disabled = true;
      btn.innerHTML = '<span>Generating…</span>';
      btn.style.backgroundColor = '#5c5c5c';

      const post = await AIService.fetchPost(topic);

      btn.disabled = false;
      btn.style.backgroundColor = '#0a66c2';
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/></svg><span>AI Post</span>`;

      if (post) {
        EditorHandler.insertText(editor, post);
      } else {
        alert('Could not generate a post. Please try again.');
      }
    });

    container.appendChild(btn);
  },

  _promptForTopic(editor) {
    return new Promise((resolve) => {
      const root = editor.getRootNode();
      const container = root instanceof ShadowRoot ? root : document.body;
      container.querySelector('#ai-post-topic-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'ai-post-topic-overlay';
      overlay.style.cssText = 'position:fixed; inset:0; z-index:999999; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

      const box = document.createElement('div');
      box.style.cssText = 'background:#1b1f23; color:#fff; padding:20px 22px; border-radius:8px; width:380px; max-width:90vw; box-shadow:0 8px 30px rgba(0,0,0,0.45);';
      box.innerHTML = `
        <h3 style="margin:0 0 8px;font-size:16px;font-weight:600;">✨ Generate a LinkedIn post</h3>
        <p style="margin:0 0 10px;font-size:13px;color:#bbb;">What should this post be about?</p>
        <textarea id="ai-post-topic-input" rows="3" placeholder="e.g. Benefits of web scraping..." style="width:100%;padding:8px;border-radius:4px;border:1px solid #444;background:#2b2f33;color:#fff;font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button id="ai-post-cancel-btn" type="button" style="padding:8px 14px;border:none;border-radius:16px;background:#3a3f44;color:#fff;cursor:pointer;font-size:13px;">Cancel</button>
          <button id="ai-post-generate-btn" type="button" style="padding:8px 14px;border:none;border-radius:16px;background:#0a66c2;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Generate</button>
        </div>`;

      overlay.appendChild(box);
      container.appendChild(overlay);

      ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'contextmenu'].forEach(evt =>
        box.addEventListener(evt, e => e.stopPropagation())
      );

      const input = box.querySelector('#ai-post-topic-input');
      setTimeout(() => input.focus(), CONFIG.TIMEOUTS.overlayFocusDelay);

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      box.querySelector('#ai-post-cancel-btn').addEventListener('click', () => cleanup(null));
      box.querySelector('#ai-post-generate-btn').addEventListener('click', () => {
        const val = input.value.trim();
        cleanup(val || null);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(null);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          box.querySelector('#ai-post-generate-btn').click();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(null);
        }
      });
    });
  },
};

// ============================================================
// 8. SCANNER & OBSERVERS
// ============================================================

const Scanner = {
  scanCommentBoxes() {
    try {
      const boxes = Utils.findElements(document, CONFIG.SELECTORS.commentBox, 'scanComments', false);
      for (const box of boxes) {
        const editor = Utils.findElements(box, CONFIG.SELECTORS.commentEditor, 'commentEditor', true);
        if (editor) UIInjector.createCommentButton(box, editor);
      }
    } catch (err) {
      log('❌ scanCommentBoxes failed — LinkedIn DOM may have changed', err.message);
    }
  },

  scanPostEditors() {
    try {
      let editors = Utils.findElements(document, CONFIG.SELECTORS.postEditor, 'postEditors', false);
      const shadowHost = document.querySelector(CONFIG.SELECTORS.shadowHost);
      if (shadowHost?.shadowRoot) {
        const shadowEditors = Utils.findElements(shadowHost.shadowRoot, CONFIG.SELECTORS.postEditor, 'postEditors(shadow)', false);
        editors = editors.concat(shadowEditors);
      }
      const unique = new Set(editors);
      for (const editor of unique) {
        if (editor.hasAttribute('data-ai-post-mutated')) continue;
        editor.setAttribute('data-ai-post-mutated', 'true');
        UIInjector.createPostButton(editor);
      }
    } catch (err) {
      log('❌ scanPostEditors failed — LinkedIn DOM may have changed', err.message);
    }
  },

  scanAll() {
    log('🔍 Running full scan...');
    this.scanCommentBoxes();
    this.scanPostEditors();
  },

  _observer: null,
  _backupTimer: null,

  start() {
    AIService._initCacheInvalidation();
    const debouncedScan = Utils.debounce(() => this.scanAll(), CONFIG.TIMEOUTS.scanDebounce);
    this._observer = new MutationObserver(debouncedScan);
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._backupTimer = setInterval(() => this.scanAll(), CONFIG.TIMEOUTS.backupInterval);
    window.addEventListener('beforeunload', () => this.stop());
    log('✅ Observers and backup interval started.');
  },

  stop() {
    this._observer?.disconnect();
    clearInterval(this._backupTimer);
    log('🛑 Observers stopped (page unloading).');
  },
};

// ============================================================
// 9. INITIALIZATION
// ============================================================

Scanner.start();