// Saves options to chrome.storage
const saveOptions = () => {
  const apiKey = document.getElementById("apiKey").value;
  const apiProvider = document.getElementById("apiProvider").value;

  chrome.storage.sync.set({ apiKey, apiProvider }, () => {
    console.log("✅ Options saved:", { apiKey, apiProvider });
    const status = document.getElementById("status");
    status.textContent = "Options saved.";
    setTimeout(() => { status.textContent = ""; }, 1000);
  });
};

// Restores select box and input state using stored preferences
const restoreOptions = () => {
  chrome.storage.sync.get(
    { apiKey: "", apiProvider: "groq" }, // default to groq
    (items) => {
      document.getElementById("apiKey").value = items.apiKey;
      document.getElementById("apiProvider").value = items.apiProvider;
      console.log("🔄 Restored options:", items);
    }
  );
};

document.addEventListener("DOMContentLoaded", restoreOptions);
document.getElementById("save").addEventListener("click", saveOptions);
