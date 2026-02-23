const saveOptions = () => {
  const format = document.querySelector('input[name="format"]:checked').value;

  chrome.storage.sync.set({ copyFormat: format }, () => {
    const status = document.getElementById('status');
    status.textContent = '¡Configuración guardada!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
};

const restoreOptions = () => {
  chrome.storage.sync.get({ copyFormat: 'richText' }, (items) => {
    document.getElementById(items.copyFormat).checked = true;
  });
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);