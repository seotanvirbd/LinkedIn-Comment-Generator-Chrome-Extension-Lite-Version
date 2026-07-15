// get api key and api provider from popup.html input and save to chrome.storage
const saveOptions = () => {
  const apiKey = document.getElementById("apiKey").value;
  const apiProvider = document.getElementById("apiProvider").value;

  chrome.storage.local.set({ apiKey, apiProvider }, () => {
    console.log("✅ Options saved:", { apiKey, apiProvider });
    const status = document.getElementById("status");
    status.textContent = "Options saved.";
    setTimeout(() => { status.textContent = ""; }, 1000);
  });
};

// get api key and api provider from previously saved chrome.storage and 
// get popup.html input UI so that user can see the previously saved values
const restoreOptions = () => {
  chrome.storage.local.get(
    { apiKey: "", apiProvider: "groq" }, // default to groq
    (items) => {
      document.getElementById("apiKey").value = items.apiKey;
      document.getElementById("apiProvider").value = items.apiProvider;
      console.log("🔄 Restored options:", items);
    }
  );
};

document.addEventListener("DOMContentLoaded", restoreOptions); //Open popup → restoreOptions → UI shows saved values.
document.getElementById("save").addEventListener("click", saveOptions); //Click Save → saveOptions → values stored in Chrome sync.
