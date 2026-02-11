(async function(){
  'use strict';

  const STORAGE_KEY = 'taskManager.tasks.v1';

  // Helpers
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, attrs = {}, children = []) => {
    const e = document.createElement(tag);
    Object.keys(attrs).forEach(k => {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    children.forEach(c => e.appendChild(c));
    return e;
  };

  // Safely get text from input by id (ignores malformed ids with #)
  const getById = (id) => {
    if (!id) return null;
    // If id starts with '#', trim it
    let use = id.startsWith('#') ? id.slice(1) : id;
    return document.getElementById(use) || document.querySelector(`[id="${id}"]`);
  };

  // Elements (prefer class selectors to avoid depending on weird ids)
  const form = qs('.task-form');
  const inputTitle = getById('title');
  const inputDesc = getById('description');
  const listRoot = qs('.task-list');
  const countEl = qs('.count');
  const emptyState = qs('.empty-state');

  if (!form || !inputTitle || !listRoot) {
    console.warn('Task Manager: required DOM elements not found. Aborting script.');
    return;
  }

  // Task model
  let tasks = [];
  let idCounter = Date.now();

  function uid() { return (idCounter++).toString(36); }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.warn('Could not save tasks to localStorage', e);
    }
  }

  async function load() {
    // 1. Try localStorage
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        tasks = JSON.parse(raw);
        if (!Array.isArray(tasks)) tasks = [];
        return;
      }
    } catch (e) { /* fallthrough */ }

    // 2. Check for a global DEFAULT_TASKS variable (user-provided JSON)
    if (window.DEFAULT_TASKS && Array.isArray(window.DEFAULT_TASKS)) {
      tasks = window.DEFAULT_TASKS.map(t => normalizeTask(t));
      return;
    }

    // 3. Fall back to parsing existing DOM list items (if any)
    const existing = qsa('.task-list > .task-item');
    if (existing.length) {
      tasks = existing.map((li, i) => {
        const cb = li.querySelector('input[type="checkbox"]');
        const title = li.querySelector('.task-title')?.textContent?.trim() || `Task ${i+1}`;
        const desc = li.querySelector('.task-desc')?.textContent?.trim() || '';
        return {
          id: li.getAttribute('data-id') || uid(),
          title,
          description: desc,
          completed: cb?.checked || li.classList.contains('completed') || false,
          createdAt: Date.now()
        };
      });
      save();
    } else {
      // 4. Try to load bundled default_task.json (if available)
      try {
        const resp = await fetch('default_task.json');
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length) {
            // map the file shape to our internal shape
            tasks = data.map(item => normalizeTask({
              id: item.id,
              title: item.task,
              description: item.description || '',
              completed: !!item.isComplete,
              createdAt: item.createdAt || Date.now()
            }));
            save();
            return;
          }
        }
      } catch (err) {
        // fetch failed (likely file:// or missing). fall through to empty
      }

      tasks = [];
    }
  }

  function normalizeTask(t) {
    return {
      id: t.id || uid(),
      title: String(t.title || '').trim(),
      description: String(t.description || '').trim(),
      completed: !!t.completed,
      createdAt: t.createdAt || Date.now()
    };
  }

  function render() {
    // clear
    listRoot.innerHTML = '';

    if (!tasks.length) {
      emptyState?.removeAttribute('hidden');
    } else {
      emptyState?.setAttribute('hidden', '');
    }

    tasks.forEach(task => {
      const li = el('li', { class: `task-item${task.completed ? ' completed' : ''}` });
      li.setAttribute('data-id', task.id);

      const label = el('label', { class: 'task-main' });
      const checkbox = el('input', { type: 'checkbox' });
      if (task.completed) checkbox.checked = true;

      const body = el('div', { class: 'task-body' });
      const title = el('div', { class: 'task-title', text: task.title });
      body.appendChild(title);
      if (task.description) {
        const desc = el('div', { class: 'task-desc', text: task.description });
        body.appendChild(desc);
      }

      label.appendChild(checkbox);
      label.appendChild(body);

      const actions = el('div', { class: 'task-actions' });
      const editBtn = el('button', { class: 'btn btn-icon edit', title: 'Edit' });
      editBtn.textContent = '✎';
      const delBtn = el('button', { class: 'btn btn-icon danger delete', title: 'Delete' });
      delBtn.textContent = '🗑';
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      li.appendChild(label);
      li.appendChild(actions);

      listRoot.appendChild(li);
    });

    // update count
    if (countEl) countEl.textContent = String(tasks.length);
  }

  // Operations
  function addTask({ title, description }) {
    title = String(title || '').trim();
    if (!title) return false;
    const task = {
      id: uid(),
      title,
      description: String(description || '').trim(),
      completed: false,
      createdAt: Date.now()
    };
    tasks.unshift(task); // newest first
    save();
    render();
    return true;
  }

  function removeTask(id) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    save();
    render();
    return true;
  }

  function toggleComplete(id, completed) {
    const t = tasks.find(x => x.id === id);
    if (!t) return false;
    t.completed = !!completed;
    save();
    render();
    return true;
  }

  // Event listeners
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = (inputTitle.value || '').trim();
    const desc = (inputDesc?.value || '').trim();
    if (!title) {
      inputTitle.focus();
      return;
    }
    const added = addTask({ title, description: desc });
    if (added) {
      form.reset();
      inputTitle.focus();
    }
  });

  // Delegate clicks inside the list for delete, edit, checkbox toggle
  listRoot.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = li.getAttribute('data-id');

    if (btn.classList.contains('delete')) {
      removeTask(id);
    } else if (btn.classList.contains('edit')) {
      // simple inline edit prompt (non-destructive)
      const t = tasks.find(x => x.id === id);
      if (!t) return;
      const newTitle = prompt('Edit task title', t.title);
      if (newTitle === null) return;
      t.title = String(newTitle).trim() || t.title;
      save();
      render();
    } else if (btn.classList.contains('reopen')) {
      toggleComplete(id, false);
    }
  });

  // Checkbox change
  listRoot.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = li.getAttribute('data-id');
    toggleComplete(id, cb.checked);
  });

  // Initialize
  await load();
  render();

  // Expose a tiny API for debugging
  window.TaskManager = {
    addTask: (t) => addTask(t),
    removeTask: (id) => removeTask(id),
    list: () => tasks.slice()
  };
})();
