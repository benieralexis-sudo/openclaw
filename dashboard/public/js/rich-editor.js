/* ===== RICH TEXT EDITOR — Toolbar formatage email ===== */

const RichEditor = {
  create(containerId, options) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const opts = options || {};
    const placeholder = opts.placeholder || 'Ecrire une reponse...';

    container.innerHTML = `
      <div class="re-wrapper">
        <div class="re-toolbar">
          <button type="button" class="re-btn" data-cmd="bold" title="Gras (Ctrl+B)"><strong>B</strong></button>
          <button type="button" class="re-btn" data-cmd="italic" title="Italique (Ctrl+I)"><em>I</em></button>
          <button type="button" class="re-btn" data-cmd="underline" title="Souligner (Ctrl+U)"><u>U</u></button>
          <span class="re-sep"></span>
          <button type="button" class="re-btn" data-cmd="insertUnorderedList" title="Liste a puces">•</button>
          <button type="button" class="re-btn" data-cmd="createLink" title="Lien">🔗</button>
          <span class="re-sep"></span>
          <button type="button" class="re-btn re-btn-clear" data-cmd="removeFormat" title="Effacer formatage">✕</button>
        </div>
        <div class="re-content" contenteditable="true" data-placeholder="${placeholder}"></div>
      </div>
    `;

    const content = container.querySelector('.re-content');
    const toolbar = container.querySelector('.re-toolbar');

    // Toolbar actions
    toolbar.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.re-btn');
      if (!btn) return;
      ev.preventDefault();
      const cmd = btn.dataset.cmd;

      if (cmd === 'createLink') {
        const url = prompt('URL du lien :');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      content.focus();
    });

    // Keyboard shortcuts inside editor
    content.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'b') { ev.preventDefault(); document.execCommand('bold'); }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'i') { ev.preventDefault(); document.execCommand('italic'); }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'u') { ev.preventDefault(); document.execCommand('underline'); }
    });

    return {
      getHTML() { return content.innerHTML; },
      getText() { return content.innerText || content.textContent || ''; },
      setContent(text) { content.innerHTML = (text || '').replace(/\n/g, '<br>'); },
      clear() { content.innerHTML = ''; },
      focus() { content.focus(); },
      element: content
    };
  }
};
