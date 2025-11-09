/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");

// small helper to escape HTML when injecting user/assistant text into the DOM
function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Fix: the input in index.html has id="userInput" — use that first, then fall back.
// This captures what the user types into the chat box.
const chatInput =
  document.getElementById("userInput") ||
  chatForm.querySelector("input, textarea");

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  // in-memory cache on window to avoid refetching every interaction
  if (window._productsCache) return window._productsCache;
  const response = await fetch("products.json");
  const data = await response.json();
  window._productsCache = data.products;
  return window._productsCache;
}

/* Selection state: map of productId -> product object */
const selectedProducts = new Map();
const selectedProductsList = document.getElementById("selectedProductsList");

/* Conversation history for the chat — keep full history so the assistant can follow up */
const conversationMessages = [
  { role: "system", content: "You are a helpful skincare assistant." },
];

// URL of the deployed search worker. Set this to your Cloudflare Worker URL (e.g. "https://my-worker.example.workers.dev").
// If empty, web search is disabled.
const SEARCH_WORKER_URL = "";

// checkbox in the UI allowing users to toggle web search on/off
const enableSearchCheckbox = document.getElementById("enableSearch");

/**
 * Perform web search via the deployed Cloudflare worker.
 * Returns an array of result objects or null if not available.
 */
async function performWebSearch(query) {
  if (!SEARCH_WORKER_URL) return null;
  try {
    const url = `${SEARCH_WORKER_URL.replace(
      /\/+$/,
      ""
    )}/search?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) {
      console.warn("Search worker returned", resp.status);
      return null;
    }
    // If you have a proxy worker that forwards OpenAI requests server-side, set it here.
    const data = await resp.json();
    const OPENAI_PROXY_URL = "https://loreal09.anvimsiddabhattuni.workers.dev";
    return data.results || null;
  } catch (err) {
    console.warn("Web search failed:", err);
    return null;
  }
}

// localStorage key for selected product ids
const STORAGE_SELECTED_KEY = "loreal_selected_ids_v1";

// Save selected product ids to localStorage
function saveSelectedToStorage() {
  try {
    const ids = Array.from(selectedProducts.keys());
    localStorage.setItem(STORAGE_SELECTED_KEY, JSON.stringify(ids));
  } catch (err) {
    console.warn("Could not save selected products:", err);
  }
}

// Load selected product ids from storage (returns array)
function loadSelectedIdsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_SELECTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((n) => Number(n));
  } catch (err) {
    console.warn("Could not read selected products from storage:", err);
  }
  return [];
}

// Prepare messages for API: trim and add a light summary of older messages if necessary
function prepareMessagesForAPI(messages) {
  const MAX_MESSAGES = 24; // safe upper bound
  const KEEP_LAST = 12; // keep this many recent messages in full

  if (messages.length <= MAX_MESSAGES) return messages;

  const systemMsgs = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const older = nonSystem.slice(0, Math.max(0, nonSystem.length - KEEP_LAST));
  const recent = nonSystem.slice(-KEEP_LAST);

  // simple summarization: take first 140 chars of each older message
  const summaryParts = older.map((m) => {
    const prefix = m.role === "user" ? "User:" : "Assistant:";
    const txt = (m.content || "").toString().replace(/\s+/g, " ").trim();
    return `${prefix} ${txt.slice(0, 140)}`;
  });
  const summary = summaryParts.join(" | ");

  const apiMessages = [];
  if (systemMsgs.length) apiMessages.push(systemMsgs[0]);
  apiMessages.push({
    role: "system",
    content: `Summary of earlier conversation: ${summary}`,
  });
  apiMessages.push(...recent);
  return apiMessages;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div class="product-card" data-id="${product.id}" tabindex="0" role="button" aria-pressed="false">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <div class="product-head">
          <h3>${product.name}</h3>
          <button class="info-toggle" aria-expanded="false" aria-label="Show description for ${product.name}">
            <i class="fa-solid fa-circle-info"></i>
          </button>
        </div>
        <p class="product-brand">${product.brand}</p>
        <div class="product-desc" aria-hidden="true">${product.description}</div>
      </div>
    </div>
  `
    )
    .join("");

  // After rendering, re-apply selected classes for items already chosen
  applySelectedClasses();
}

/* Toggle selection for a product by id and product object */
function toggleProductSelection(id, productObj) {
  const exists = selectedProducts.has(id);
  if (exists) {
    selectedProducts.delete(id);
  } else {
    selectedProducts.set(id, productObj);
  }
  renderSelectedProductsList();
  applySelectedClasses();
  // persist selection changes
  saveSelectedToStorage();
}

/* Add .selected class to visible cards that are in selectedProducts */
function applySelectedClasses() {
  const cards = productsContainer.querySelectorAll(".product-card");
  cards.forEach((card) => {
    const id = Number(card.getAttribute("data-id"));
    if (selectedProducts.has(id)) {
      card.classList.add("selected");
      card.setAttribute("aria-pressed", "true");
    } else {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    }
  });
}

/* Render the Selected Products list with remove controls */
function renderSelectedProductsList() {
  if (selectedProducts.size === 0) {
    selectedProductsList.innerHTML =
      '<div class="placeholder-message">No products selected</div>';
    return;
  }

  selectedProductsList.innerHTML = Array.from(selectedProducts.values())
    .map(
      (p) => `
      <div class="selected-item" data-id="${p.id}">
        <img src="${p.image}" alt="${p.name}" style="width:48px;height:48px;object-fit:contain;margin-right:8px;"/>
        <div style="flex:1">
          <div style="font-weight:600">${p.name}</div>
          <div style="font-size:12px;color:var(--muted)">${p.brand}</div>
        </div>
        <button class="remove-selected" aria-label="Remove ${p.name}" data-id="${p.id}" style="background:transparent;border:none;color:var(--brand-primary);font-size:18px;cursor:pointer;padding:6px">&times;</button>
      </div>
    `
    )
    .join("");

  // attach remove handlers
  selectedProductsList.querySelectorAll(".remove-selected").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id"));
      // remove from map and update UI
      if (selectedProducts.has(id)) {
        selectedProducts.delete(id);
      }
      renderSelectedProductsList();
      applySelectedClasses();
      // persist removal
      saveSelectedToStorage();
    });
  });
}

/* Product search + category filter integration */
const productSearch = document.getElementById("productSearch");

// debounce helper
function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function filterAndDisplayProducts() {
  const all = await loadProducts();
  const category =
    categoryFilter && categoryFilter.value ? categoryFilter.value : "";
  const q =
    productSearch && productSearch.value
      ? productSearch.value.trim().toLowerCase()
      : "";

  // If no category selected and no search query, show placeholder to preserve original UX
  if (!category && !q) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        Select a category to view products
      </div>
    `;
    return;
  }

  // Start with all products, then restrict by category & query
  let filtered = all.slice();
  if (category) {
    filtered = filtered.filter((p) => p.category === category);
  }
  if (q) {
    filtered = filtered.filter((p) => {
      const hay = [p.name, p.brand, p.description].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  displayProducts(filtered);
}

const debouncedFilter = debounce(filterAndDisplayProducts, 180);

// wire category change and search input
categoryFilter.addEventListener("change", () => debouncedFilter());
if (productSearch)
  productSearch.addEventListener("input", () => debouncedFilter());

/* Helper to append a message to the chat window */
function appendChatMessage(role, text) {
  const cssClass =
    role === "user" ? "chat-message user" : "chat-message assistant";

  // escape text (uses shared escapeHtml helper) and preserve newlines
  const safe = escapeHtml(text).replace(/\n/g, "<br>");
  const messageHtml = `
    <div class="${cssClass}">
      <div class="message-bubble">${safe}</div>
    </div>
  `;

  // Add message and scroll to bottom
  chatWindow.insertAdjacentHTML("beforeend", messageHtml);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Chat form submission handler - sends user input to OpenAI Chat Completions API */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Get text the user typed
  const userMessage =
    chatInput && chatInput.value ? chatInput.value.trim() : "";
  if (!userMessage) return;

  // Show the user's message in the chat window
  appendChatMessage("user", userMessage);

  // Add user message to the conversation history
  conversationMessages.push({ role: "user", content: userMessage });

  // Clear the input for the next message
  chatInput.value = "";

  // Show a temporary "thinking" message from the assistant
  appendChatMessage("assistant", "Thinking...");
  const assistantMessages = chatWindow.querySelectorAll(
    ".chat-message.assistant .message-bubble"
  );
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
  try {
    // If web search is enabled and configured, fetch results and add them to the conversation history
    const shouldSearch =
      enableSearchCheckbox && enableSearchCheckbox.checked && SEARCH_WORKER_URL;
    if (shouldSearch) {
      const results = await performWebSearch(userMessage);
      if (results && results.length) {
        const formatted = results
          .map((r, i) => `${i + 1}. ${r.name} - ${r.snippet} (${r.url})`)
          .join("\n");
        // Add system-level info with search results and encourage the assistant to cite links.
        conversationMessages.push({
          role: "system",
          content: `Web search results for: "${userMessage}"\n\n${formatted}\n\nPlease use these results where helpful and cite sources by number.`,
        });
      }
    }

    // Call OpenAI's Chat Completions endpoint with the (possibly augmented) conversation history
    const apiMessages = prepareMessagesForAPI(conversationMessages);
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: apiMessages,
        max_tokens: 500,
      }),
    });

    // If response is not OK, include status + body for debugging
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    // Parse JSON response body
    const data = await resp.json();

    // Read the assistant's content from data.choices[0].message.content
    const assistantContent =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content
        ? data.choices[0].message.content
        : "Sorry, I could not get a response from the API.";

    // Replace the temporary "Thinking..." with the real assistant response
    if (lastAssistantMessage) {
      lastAssistantMessage.innerHTML = escapeHtml(assistantContent).replace(
        /\n/g,
        "<br>"
      );
    } else {
      appendChatMessage("assistant", assistantContent);
    }

    // Save assistant reply into conversation history so follow-ups use it
    conversationMessages.push({ role: "assistant", content: assistantContent });
  } catch (err) {
    // On error, replace thinking text with an error message and log details.
    const errorMsg = `Error contacting API. ${
      err.message || "Check your key and network."
    }`;
    if (lastAssistantMessage) {
      lastAssistantMessage.textContent = errorMsg;
    } else {
      appendChatMessage("assistant", errorMsg);
    }
    console.error("OpenAI request failed:", err);
  }
});

/* Event delegation: click or keyboard on a product card toggles selection */
productsContainer.addEventListener("click", async (e) => {
  // If the click was on the info toggle, handle description toggle and stop.
  const infoBtn = e.target.closest && e.target.closest(".info-toggle");
  if (infoBtn) {
    const card = e.target.closest(".product-card");
    if (!card) return;
    toggleDescription(card);
    return;
  }

  const card = e.target.closest && e.target.closest(".product-card");
  if (!card) return;

  const id = Number(card.getAttribute("data-id"));

  // Load product details so we can store the full object (if necessary)
  try {
    const products = await loadProducts();
    const product = products.find((p) => p.id === id);
    if (product) toggleProductSelection(id, product);
  } catch (err) {
    console.error("Failed to toggle selection:", err);
  }
});

// keyboard accessibility: Enter or Space toggles
productsContainer.addEventListener("keydown", async (e) => {
  // Ignore keyboard events originating from the info button (it handles its own activation)
  if (e.target.closest && e.target.closest(".info-toggle")) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest && e.target.closest(".product-card");
  if (!card) return;
  e.preventDefault();
  const id = Number(card.getAttribute("data-id"));
  try {
    const products = await loadProducts();
    const product = products.find((p) => p.id === id);
    if (product) toggleProductSelection(id, product);
  } catch (err) {
    console.error("Failed to toggle selection:", err);
  }
});

/* Toggle inline description inside a product card */
function toggleDescription(card) {
  const desc = card.querySelector(".product-desc");
  const btn = card.querySelector(".info-toggle");
  if (!desc || !btn) return;
  const isOpen = desc.classList.toggle("open");
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  desc.setAttribute("aria-hidden", isOpen ? "false" : "true");
}

// initialize: load products cache and restore selections from storage
async function init() {
  try {
    await loadProducts(); // populate cache
    const ids = loadSelectedIdsFromStorage();
    if (ids && ids.length) {
      // map ids to product objects from cache
      const all = window._productsCache || [];
      ids.forEach((id) => {
        const p = all.find((x) => x.id === id);
        if (p) selectedProducts.set(p.id, p);
      });
    }
  } catch (err) {
    console.warn("Initialization loadProducts failed:", err);
  }
  renderSelectedProductsList();
  applySelectedClasses();
}

init();

// RTL toggle: read saved preference and wire up toggle button
const dirToggle = document.getElementById("dirToggle");
const DIR_STORAGE_KEY = "loreal_dir_v1";
function applySavedDir() {
  try {
    const saved = localStorage.getItem(DIR_STORAGE_KEY);
    if (saved === "rtl") {
      document.documentElement.setAttribute("dir", "rtl");
      if (dirToggle) dirToggle.textContent = "LTR";
    } else {
      document.documentElement.setAttribute("dir", "ltr");
      if (dirToggle) dirToggle.textContent = "RTL";
    }
  } catch (e) {
    console.warn("Could not read dir from storage", e);
  }
}
applySavedDir();
if (dirToggle) {
  dirToggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("dir") || "ltr";
    const next = cur === "rtl" ? "ltr" : "rtl";
    document.documentElement.setAttribute("dir", next);
    try {
      localStorage.setItem(DIR_STORAGE_KEY, next);
    } catch (e) {}
    dirToggle.textContent = next === "rtl" ? "LTR" : "RTL";
  });
}

/* Generate Routine: send selected products JSON to OpenAI and display routine */
const generateBtn = document.getElementById("generateRoutine");
if (generateBtn) {
  generateBtn.addEventListener("click", async () => {
    // collect selected products into a simple JSON array
    const items = Array.from(selectedProducts.values()).map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description,
    }));

    if (items.length === 0) {
      appendChatMessage(
        "assistant",
        "Please select one or more products before generating a routine."
      );
      return;
    }

    // Show the user's intent as a message (optional but helpful in chat)
    const userIntent = `Generate a personalized routine based on these selected products: ${items
      .map((i) => i.name)
      .join(", ")}`;
    appendChatMessage("user", userIntent);
    // add the short intent into conversation history
    conversationMessages.push({ role: "user", content: userIntent });

    // Show assistant thinking placeholder
    appendChatMessage("assistant", "Thinking...");
    const assistantMessages = chatWindow.querySelectorAll(
      ".chat-message.assistant .message-bubble"
    );
    const lastAssistantMessage =
      assistantMessages[assistantMessages.length - 1];

    // Add a detailed user-level routine instruction (with the JSON) to the conversation history
    const routineMessage =
      "Please generate a clear, ordered personalized routine (AM/PM, why to use each product, warnings) using only the following selected products JSON:\n\n" +
      JSON.stringify({ selectedProducts: items }, null, 2);
    conversationMessages.push({ role: "user", content: routineMessage });

    // If web search is enabled and configured, fetch results about these products and include them
    const shouldSearch =
      enableSearchCheckbox && enableSearchCheckbox.checked && SEARCH_WORKER_URL;
    if (shouldSearch) {
      // build a search query from the selected product names
      const query =
        items.map((i) => i.name).join("; ") + " L'Oréal product information";
      const results = await performWebSearch(query);
      if (results && results.length) {
        const formatted = results
          .map((r, i) => `${i + 1}. ${r.name} - ${r.snippet} (${r.url})`)
          .join("\n");
        conversationMessages.push({
          role: "system",
          content: `Web search results for selected products:\n\n${formatted}\n\nPlease use these results where helpful and cite sources by number.`,
        });
      }
    }

    // disable the button to prevent double submits
    generateBtn.disabled = true;
    generateBtn.setAttribute("aria-busy", "true");

    try {
      const apiMessages = prepareMessagesForAPI(conversationMessages);
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: apiMessages,
          max_tokens: 700,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }

      const data = await resp.json();
      const assistantContent =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content
          ? data.choices[0].message.content
          : "Sorry, I could not get a response from the API.";

      if (lastAssistantMessage) {
        lastAssistantMessage.innerHTML = escapeHtml(assistantContent).replace(
          /\n/g,
          "<br>"
        );
      } else {
        appendChatMessage("assistant", assistantContent);
      }

      // Save assistant reply into conversation history so follow-ups use it
      conversationMessages.push({
        role: "assistant",
        content: assistantContent,
      });
    } catch (err) {
      const errorMsg = `Error contacting API. ${
        err.message || "Check your key and network."
      }`;
      if (lastAssistantMessage) {
        lastAssistantMessage.innerHTML = escapeHtml(errorMsg).replace(
          /\n/g,
          "<br>"
        );
      } else {
        appendChatMessage("assistant", errorMsg);
      }
      console.error("Generate Routine failed:", err);
    } finally {
      generateBtn.disabled = false;
      generateBtn.removeAttribute("aria-busy");
    }
  });
}

/* Clear all selections handler */
const clearBtn = document.getElementById("clearSelections");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    const confirmClear = confirm(
      "Clear all selected products? This cannot be undone."
    );
    if (!confirmClear) return;
    selectedProducts.clear();
    renderSelectedProductsList();
    applySelectedClasses();
    saveSelectedToStorage();
  });
}
