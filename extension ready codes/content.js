'use strict';

// ============================================================
// AI LINKEDIN CHROME EXTENSION — CONTENT SCRIPT (LITE / FREE VERSION)
// ============================================================
// WHAT THIS FILE DOES
//   Runs on linkedin.com. Watches the page for comment boxes and injects
//   an "AI Suggestion" button, sends context to an AI provider
//   (OpenAI/Groq/Gemini), and inserts the generated reply back into
//   LinkedIn's comment editor.
//
//   NOTE: This is the LITE edition — AI POST GENERATION IS NOT INCLUDED.
//   Only AI-assisted commenting is available. Upgrade to the Premium
//   version for the "AI Post" composer feature.
//
// FILE MAP (search for these section headers)
//   0. LOGGER            – console logging helper, also mirrors to popup
//   1. CONFIGURATION      – all CSS selectors, prompts, endpoints, timeouts
//   2. UTILITIES          – selector search, fetch wrapper, text cleanup
//   3. CONFIGURATION STORAGE – reads apiKey/apiProvider from chrome.storage
//   4. DOM EXTRACTION     – pulls author/post/comment text out of the page
//   5. AI SERVICE         – builds requests to OpenAI/Groq/Gemini
//   6. EDITOR HANDLER     – inserts generated text into LinkedIn's editor
//   7. UI INJECTION       – creates & wires up the AI comment button
//   8. SCANNER & OBSERVERS – MutationObserver + backup poll that (re)runs
//                            the scan whenever LinkedIn re-renders the DOM
//   9. INITIALIZATION     – kicks everything off
//
// HOW TO DEBUG
//   Every meaningful step logs via log() below, prefixed
//   "[Mohammad Tanvir's Bot]" with the calling function/line auto-attached.
//   Open DevTools → Console on linkedin.com and filter by that prefix.
//   If a selector stops matching (LinkedIn changed its markup), you'll see
//   a "⚠️ No selectors matched in <context>" log naming exactly which
//   lookup failed — update the matching array in CONFIG.SELECTORS.
//   See DEVELOPER_GUIDE.md for the full breakage/troubleshooting workflow.
// ============================================================

// ============================================================
// 0. LOGGER (single source of truth for all debug output)
// ============================================================
//version 3 1. 3 strategies added in editor handler

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
  // Each key holds an ARRAY of CSS selectors, tried in order — first match wins
  // (see Utils.findElements). Put the current/most-specific selector first and
  // keep older ones as fallbacks. When LinkedIn changes its markup, add the
  // new selector to the FRONT of the relevant array; console logs will tell
  // you exactly which key needs updating (see file header / DEVELOPER_GUIDE.md).
  SELECTORS: {
    commentBox: ['[componentkey^="commentBox-"]', '[data-testid="comment-box"]', '.comment-box'],
    commentEditor: ['[contenteditable="true"][role="textbox"]', '.ProseMirror', 'textarea'],
    commentToolbar: ['[data-testid="ui-core-tiptap-text-editor-wrapper"] ~ div', '.ql-toolbar', 'div[role="toolbar"]'],
    postContainer: ['[role="listitem"]', '[data-testid="feed-post"]', 'article', '.feed-shared-update-v2'],
    postText: ['[data-testid="expandable-text-box"]', '.feed-shared-text', '.break-words'],
    authorLabel: ['figure[aria-label]', 'a[aria-label]', '[data-testid="feed-identity-label"]'],
    commentItem: ['[componentkey*="replaceableComment"]', '[data-testid="comment-item"]', '.comment-item'],
    // NOTE (Lite version): postEditor/shadowHost selectors removed on purpose —
    // they were only used by the AI Post composer feature (Premium-only).
    // postContainer/postText/authorLabel above are still required: they let
    // the comment feature read the ORIGINAL POST's context to write a
    // relevant reply.
  },

  FALLBACK_MODELS: {
    groq: ['llama-4-maverick-17b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    openai: ['gpt-4o-mini'],
    gemini: ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash'],
  },

  PROMPTS: {
    comment: `You are an assistant that writes replies to LinkedIn posts. Use same language, sound human, friendly, no hashtags, use occasional emojis, keep it brief, positive and add value. Mention author only if individual, not company.`,
    // NOTE (Lite version): "post" prompt template removed — AI Post
    // generation is a Premium-only feature.
  },

  TIMEOUTS: {
    scanDebounce: 200,
    backupInterval: 1000,
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
        // Common causes: 401/403 = bad/expired API key, 429 = rate limited,
        // network/CORS error = host_permissions in manifest.json may be stale.
        throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 100)}`);
      }
      const data = await res.json();
      log(`🔍 Request succeeded for ${context} (HTTP ${res.status})`);
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
      const data = await chrome.storage.local.get(['apiKey', 'apiProvider']);
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
    if (!el) {
      log('⚠️ extractAuthor called with no element (authorLabel selector likely found nothing)');
      return null;
    }

    // 1. Try extracting from aria-label first
    const label = el.getAttribute('aria-label') || '';
    if (label) {
      // Matches both straight (') and curly (’) quotes directly in the regex
      const match = label.match(/^View (?:company: )?(.+?)(?:['’]s profile.*)?$/i);
      if (match) {
        log(`🔍 Author extracted from aria-label: "${match[1].trim()}"`);
        return match[1].trim();
      }
      log(`⚠️ aria-label present but regex did not match: "${label}" — LinkedIn may have changed its aria-label wording`);
    } else {
      log('ℹ️ No aria-label on author element, trying innerText fallback');
    }

    // 2. Fallback: If aria-label is translated or missing, read the visible inner text
    const visibleText = el.innerText?.trim();
    if (visibleText && visibleText.length > 0 && visibleText.length < 60) {
      // Filter out multiline text (e.g., if we grabbed a whole header card by mistake)
      if (!visibleText.includes('\n')) {
        log(`🔍 Author extracted from innerText fallback: "${visibleText}"`);
        return visibleText;
      }
      log('⚠️ innerText fallback rejected: contains multiple lines (likely grabbed a whole card, not just the name)');
    } else if (visibleText) {
      log(`⚠️ innerText fallback rejected: length ${visibleText.length} (too long to be a name)`);
    }

    log('❌ extractAuthor failed both aria-label and innerText strategies — returning null');
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
      log(`⚠️ Could not find parent post — AI prompt will be built without post context`);
      return { author: 'Someone', text: '' };
    }
    const authorEl = Utils.findElements(post, CONFIG.SELECTORS.authorLabel, 'extractAuthor', true);
    const author = this.extractAuthor(authorEl) || 'Someone';
    const textEl = Utils.findElements(post, CONFIG.SELECTORS.postText, 'extractText', true);
    const text = textEl?.innerText || '';
    if (!textEl) {
      log('⚠️ postText selector matched nothing — CONFIG.SELECTORS.postText may need updating for this post type');
    }
    log(`🔍 extractPostContext result: author="${author}", textLength=${text.length}`);
    return { author, text };
  },

  extractReplyContext(commentBox) {
    // Returns null when this comment box is a top-level comment (not a reply-to-a-reply),
    // which is expected and NOT an error — CONFIG.SELECTORS.commentItem just found no ancestor.
    const parent = commentBox.closest(CONFIG.SELECTORS.commentItem.join(','));
    if (!parent) {
      log('ℹ️ extractReplyContext: no ancestor comment item found — treating as a top-level comment');
      return null;
    }
    const authorEl = parent.querySelector(CONFIG.SELECTORS.authorLabel.join(','));
    const author = this.extractAuthor(authorEl) || 'A user';
    const textEl = parent.querySelector('[data-testid="expandable-text-box"], .comment__content');
    const text = textEl?.innerText || '';
    if (!textEl) {
      log('⚠️ Reply text selector matched nothing — LinkedIn may have renamed .comment__content');
    }
    log(`🔍 extractReplyContext result: author="${author}", textLength=${text.length}`);
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
        if (area === 'local' && (changes.apiKey || changes.apiProvider)) {
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

  // Tries each available model for the chosen provider in order until one
  // returns usable content (handles deprecated/overloaded/quota-exhausted
  // models gracefully instead of failing outright on the first one).
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

  // NOTE (Lite version): fetchPost() removed — AI Post generation is a
  // Premium-only feature.
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
    let success = false;

    // ── Strategy 1: Clipboard paste (most future-proof, Quill handles it natively) ──
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);

      // First clear existing content via select-all + delete
      const selAll = window.getSelection();
      const rangeAll = document.createRange();
      rangeAll.selectNodeContents(editor);
      selAll.removeAllRanges();
      selAll.addRange(rangeAll);
      document.execCommand('delete', false);

      editor.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));

      // Give Quill a tick to process the paste event
      success = !!editor.textContent.trim();
      if (success) {
        log(`✅ Text inserted via clipboard paste (Strategy 1)`);
      } else {
        log(`⚠️ Strategy 1 (clipboard paste) ran without error but editor is still empty — falling back to Strategy 2`);
      }
    } catch (e) {
      log(`⚠️ Strategy 1 (clipboard paste) threw an error: ${e.message} — falling back to Strategy 2`);
    }

    // ── Strategy 2: execCommand insertHTML (deprecated but widely supported) ──
    if (!success) {
      try {
        const range = document.createRange();
        range.selectNodeContents(editor);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false);

        const htmlContent = text.split('\n').map(line => line || '').join('<br>');
        const cmdSuccess = document.execCommand('insertHTML', false, htmlContent);
        success = cmdSuccess && !!editor.textContent.trim();
        if (success) {
          log(`✅ Text inserted via execCommand (Strategy 2)`);
        } else {
          log(`⚠️ Strategy 2 (execCommand) reported cmdSuccess=${cmdSuccess} but editor is still empty — falling back to Strategy 3`);
        }
      } catch (e) {
        log(`⚠️ Strategy 2 (execCommand) threw an error: ${e.message} — falling back to Strategy 3`);
      }
    }

    // ── Strategy 3: Direct innerHTML (last resort) ──
    // This bypasses LinkedIn's editor framework (React/Quill) entirely, so it
    // always "succeeds" at inserting text, but the framework may not register
    // the change (e.g. the Post/Comment button might stay disabled). If you
    // see this log a lot, Strategies 1 & 2 need fixing — this is a last resort.
    if (!success) {
      log(`⚠️ Strategies 1 & 2 both failed — falling back to direct innerHTML (Strategy 3, least reliable)`);
      editor.innerHTML = text
        .split('\n')
        .map(l => l.trim() ? `<p>${l}</p>` : '<p><br></p>')
        .join('');
      success = true;
    }

    // ── Notify framework (React / Quill) of the change ──
    editor.classList.remove('ql-blank');

    // Dispatch proper event types — InputEvent only for 'input', Event for the rest
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: text,
    }));
    ['change', 'keyup'].forEach(evtType => {
      editor.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true }));
    });

    log(`✅ Text inserted into editor`);
    return success;
  },
};

// ============================================================
// 7. UI INJECTION
// ============================================================

const UIInjector = {
  createCommentButton(commentBox, editor) {
    if (commentBox.hasAttribute('data-ai-mutated')) {
      log('⏭️ commentBox already mutated, skipping');
      return;
    }
    commentBox.setAttribute('data-ai-mutated', 'true');
    log('🛠️ Creating comment AI button', { commentBox, editor });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'artdeco-button artdeco-button--muted artdeco-button--tertiary artdeco-button--circle';
    btn.title = 'AI Suggestion';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/></svg>`;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      log('🖱️ Comment AI button clicked');
      btn.disabled = true;
      try {
        const prompt = DomExtractor.buildCommentPrompt(commentBox);
        log('⏳ Requesting comment reply from AIService...');
        const reply = await AIService.fetchCommentReply(prompt);
        if (reply) {
          log('✅ Reply received, inserting into editor', reply);
          EditorHandler.insertText(editor, reply);
        } else {
          log('❌ No reply generated (empty response from AIService)');
        }
      } catch (err) {
        log('❌ Unexpected error handling comment click', err.message);
      } finally {
        btn.disabled = false;
      }
    });

    const toolbar = Utils.findElements(commentBox, CONFIG.SELECTORS.commentToolbar, 'commentToolbar', true);
    if (toolbar) {
      log('✅ Toolbar found, prepending button to toolbar');
      toolbar.prepend(btn);
    } else if (editor.parentElement) {
      log('⚠️ Toolbar not found, appending button to editor.parentElement as fallback');
      editor.parentElement.appendChild(btn);
    } else {
      log('❌ Could not attach comment button — no toolbar and no editor.parentElement');
    }
  },

  // NOTE (Lite version): createPostButton() and _promptForTopic() removed —
  // AI Post generation is a Premium-only feature.
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

  // NOTE (Lite version): scanPostEditors() removed — AI Post generation is
  // a Premium-only feature, so the post composer is never scanned.

  scanAll() {
    log('🔍 Running full scan (comments only — Lite version)...');
    this.scanCommentBoxes();
  },

  _observer: null,
  _backupTimer: null,
  _observerFireCount: 0,

  start() {
    AIService._initCacheInvalidation();
    const debouncedScan = Utils.debounce(() => {
      this._observerFireCount++;
      this.scanAll();
    }, CONFIG.TIMEOUTS.scanDebounce);
    this._observer = new MutationObserver(debouncedScan);
    this._observer.observe(document.body, { childList: true, subtree: true });

    // Backup interval runs at normal speed until the MutationObserver proves
    // itself reliable (a few successful fires), then slows down to save CPU
    // on long-running LinkedIn sessions. It never fully stops, as a safety net.
    this._backupTimer = setInterval(() => {
      this.scanAll();
      if (this._observerFireCount >= 3) {
        log('🐢 MutationObserver proven reliable — slowing backup interval to save CPU');
        clearInterval(this._backupTimer);
        this._backupTimer = setInterval(() => this.scanAll(), CONFIG.TIMEOUTS.backupInterval * 6);
      }
    }, CONFIG.TIMEOUTS.backupInterval);

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
// If this section never logs "Extension initialized", the content script
// itself failed to load/run — check chrome://extensions for a red "Errors"
// badge, or check the Console for a syntax error thrown before this point.

try {
  log('🚀 Extension initialized — starting DOM scanner and observers');
  Scanner.start();
} catch (err) {
  log('❌ FATAL: Scanner failed to start — extension will not function on this page', err.message);
}