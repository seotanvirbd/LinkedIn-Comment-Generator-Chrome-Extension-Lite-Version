const PRO_LINKS = { bd: "https://seotanvirbd.com/product/ai-linkedin-post-comment-generator-pro-unlimited-ai-automation-for-chrome/",
                    intl: "https://mohammadtanvir.gumroad.com/l/yhxkvp" };

// get api key and api provider from popup.html input and save to chrome.storage
const saveOptions = () => {
  const apiKey = document.getElementById("apiKey").value;
  const apiProvider = document.getElementById("apiProvider").value;
  const country = document.getElementById("country").value;

  chrome.storage.local.set({ apiKey, apiProvider, country }, () => {
    console.log("✅ Options saved:", { apiKey, apiProvider, country });
    const status = document.getElementById("status");
    status.textContent = "Options saved.";
    setTimeout(() => { status.textContent = ""; }, 1000);
    setUpgradeLink(country);
  });
};

// get api key and api provider from previously saved chrome.storage and 
// get popup.html input UI so that user can see the previously saved values
const restoreOptions = () => {
  chrome.storage.local.get(
    { apiKey: "", apiProvider: "groq", country: "intl" }, // default to groq, intl
    (items) => {
      document.getElementById("apiKey").value = items.apiKey;
      document.getElementById("apiProvider").value = items.apiProvider;
      document.getElementById("country").value = items.country;
      console.log("🔄 Restored options:", items);
      setUpgradeLink(items.country);
    }
  );
};

// Point the popup's upgrade link at the saved country's Pro page
const setUpgradeLink = (country) => {
  document.getElementById("upgradeLink").href = PRO_LINKS[country] || PRO_LINKS.intl;
};

document.addEventListener("DOMContentLoaded", restoreOptions); //Open popup → restoreOptions → UI shows saved values.
document.getElementById("save").addEventListener("click", saveOptions); //Click Save → saveOptions → values stored in Chrome sync.
