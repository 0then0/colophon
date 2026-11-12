// Colophon import engine: the part of the StoryGraph import that talks to the vault.
//
// A function body like model.js: no arguments, returns the API object. It gets everything it uses
// from create(...), and of Obsidian it uses only the public Vault API (vault.create,
// vault.createFolder, vault.on/offref and the vault adapter). No file system paths, no Node, no
// Electron, no DOM: the same code runs on desktop, on mobile and, with a stand-in vault, in the tests.
//
//   vault     app.vault
//   model     Colophon/model.js, evaluated
//   core      Colophon/storygraph.js, evaluated
//   root      vault path of the Colophon folder
//   registry  an object shared by every import view of this Obsidian instance
const SCAN_BATCH = 8;

const create = ({ vault, model, core, root, registry }) => {
  const adapter = vault.adapter;
  const { LIMITS } = core;
  // One run at a time for the whole instance, whatever number of import views is open. `last` is
  // the result of the latest run; it stays until a view dismisses it or the next run ends.
  const shared = (registry.storygraphImport ??= { run: null, last: null, listeners: new Set() });
  const announce = () => {
    for (const listener of [...shared.listeners]) listener();
  };

  class ImportError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }
  const describe = (error) =>
    error instanceof ImportError || error instanceof core.CsvError
      ? { code: error.code, details: error.details }
      : { code: 'unexpected', details: { message: String(error?.message ?? error) } };

  const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);
  const isMarkdown = (path) => path.toLowerCase().endsWith('.md');
  const readJson = async (path) => JSON.parse(await adapter.read(path));

  // ---- Settings ------------------------------------------------------------------------------
  // Read from the files every time: the preview and the run must not trust what a page loaded
  // earlier. The rules are those of the command line: a config with problems stops the import,
  // "auto" writes English headings, and a language needs its locale file.
  const context = async () => {
    let settings;
    try {
      settings = model.resolve(await readJson(`${root}/config.json`));
    } catch {
      throw new ImportError('config');
    }
    if (settings.problems.length) throw new ImportError('config');
    const english = await readJson(`${root}/locales/en.json`);
    const catalog = model.catalog(settings, 'en', (key) => english[key]);
    const wanted = settings.language === 'auto' ? 'en' : settings.language;
    const code = (await adapter.list(`${root}/locales`)).files
      .map((path) => baseName(path))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .find((name) => model.normalizeTag(name) === model.normalizeTag(wanted));
    if (!code) throw new ImportError('language', { language: wanted });
    const messages =
      code === 'en' ? english : { ...english, ...(await readJson(`${root}/locales/${code}.json`)) };
    const library = settings.paths.library;
    if (library.split('/').some((part) => !part || part.startsWith('.')))
      throw new ImportError('libraryPath', { path: library });
    return {
      catalog,
      library,
      headings: { notes: messages['template.notes'], quotes: messages['template.quotes'] },
    };
  };

  // ---- Library -------------------------------------------------------------------------------
  // The identities come from the text of the notes as the adapter reads them now, not from the
  // metadata cache, which can be behind the files. Like the command line: every Markdown file of
  // the library folder and its sub-folders, except hidden folders.
  const scan = async (library) => {
    const identities = new Map(); // path -> identities
    const top = []; // names in the library folder itself, without ".md"
    if (!(await adapter.exists(library))) return { identities, top };
    if ((await adapter.stat(library))?.type !== 'folder')
      throw new ImportError('libraryPath', { path: library });
    const pending = [library];
    while (pending.length) {
      const folder = pending.pop();
      const listing = await adapter.list(folder);
      if (folder === library) {
        for (const path of [...listing.files, ...listing.folders])
          if (isMarkdown(path)) top.push(baseName(path).slice(0, -3));
      }
      const notes = listing.files.filter(isMarkdown);
      for (let i = 0; i < notes.length; i += SCAN_BATCH) {
        await Promise.all(
          notes.slice(i, i + SCAN_BATCH).map(async (path) => {
            try {
              identities.set(path, core.noteIdentities(await adapter.read(path)));
            } catch (error) {
              // A note that was removed while the folder was read is not there to match.
              if (await adapter.exists(path)) throw error;
            }
          }),
        );
      }
      for (const sub of listing.folders) if (!baseName(sub).startsWith('.')) pending.push(sub);
    }
    return { identities, top };
  };

  const build = async (text) => {
    if (text.length > LIMITS.fileBytes)
      throw new core.CsvError('tooLarge', { limit: LIMITS.fileBytes });
    const { catalog, library, headings } = await context();
    const input = core.convert(core.parseCsv(text, { maxRecords: LIMITS.rows + 1 }), catalog);
    const found = await scan(library);
    const existing = new Map();
    for (const [path, ids] of found.identities) {
      for (const id of ids) existing.set(id, [...(existing.get(id) ?? []), path]);
    }
    return { ...core.plan(input, existing, found.top), library, headings, found };
  };

  // Everything the preview shows and the run would write. Two plans with the same signature are
  // the same decision for the user.
  const signature = (plan) =>
    JSON.stringify([
      plan.library,
      plan.headings,
      plan.rows,
      plan.fresh.map((book) => [plan.names.get(book.id), book]),
      plan.known.map((book) => book.id),
      plan.skipped,
    ]);

  // ---- Run -----------------------------------------------------------------------------------
  // Notes are created one after another. Nothing is rolled back: a note that was created stays, and
  // the next import recognises it by its identity. Every book of the plan gets exactly one outcome.
  const write = async (plan, run) => {
    const result = {
      file: run.file,
      library: plan.library,
      total: plan.fresh.length,
      created: [],
      existing: [],
      conflicts: [],
      failed: [],
      notAttempted: 0,
      stopped: false,
      error: null,
    };
    const prefix = `${plan.library}/`;
    const inLibrary = (path) => path.startsWith(prefix);
    const isTop = (path) => inLibrary(path) && !path.slice(prefix.length).includes('/');

    // What the library holds, kept current while the run goes on.
    const byPath = new Map(plan.found.identities);
    const byIdentity = new Map();
    const taken = new Set(plan.found.top.map(core.nameKey));
    const learn = (path, ids) => {
      byPath.set(path, ids);
      for (const id of ids) byIdentity.set(id, (byIdentity.get(id) ?? new Set()).add(path));
      if (isTop(path)) taken.add(core.nameKey(baseName(path).slice(0, -3)));
    };
    const forget = (path) => {
      for (const id of byPath.get(path) ?? []) byIdentity.get(id)?.delete(path);
      byPath.delete(path);
      if (isTop(path)) taken.delete(core.nameKey(baseName(path).slice(0, -3)));
    };
    for (const [path, ids] of plan.found.identities) learn(path, ids);

    // Obsidian reports what changes in the library during the run (an edit, a rename, a file that
    // sync brought). Those paths are read again before the next note is created.
    const dirty = new Set();
    const own = new Set();
    const touch = (path) => {
      if (inLibrary(path) && isMarkdown(path)) dirty.add(path);
    };
    const refs = [
      vault.on('create', (file) => own.has(file.path) || touch(file.path)),
      vault.on('modify', (file) => touch(file.path)),
      vault.on('delete', (file) => touch(file.path)),
      vault.on('rename', (file, oldPath) => {
        touch(oldPath);
        touch(file.path);
      }),
    ];
    const refresh = async () => {
      for (const path of [...dirty]) {
        dirty.delete(path);
        forget(path);
        if (!(await adapter.exists(path))) continue;
        let ids = [];
        try {
          ids = core.noteIdentities(await adapter.read(path));
        } catch {
          // Not readable as a note (a folder with such a name): it still takes the name.
        }
        learn(path, ids);
      }
    };

    const createNote = async (book, name) => {
      const path = prefix + name;
      await refresh();
      if (byIdentity.get(book.id)?.size) return { type: 'existing' };
      if (taken.has(core.nameKey(name.slice(0, -3))) || (await adapter.exists(path)))
        return { type: 'conflict' };
      const note = core.renderNote(book, plan.headings, book.provenance);
      own.add(path);
      try {
        // vault.create refuses a path that exists; it never replaces a file.
        await vault.create(path, note);
      } catch (error) {
        // The error can come after the file was written, so the file decides, not the message.
        own.delete(path);
        dirty.add(path);
        const message = String(error?.message ?? error);
        let found;
        try {
          if (!(await adapter.exists(path))) return { type: 'failed', message };
          found = await adapter.read(path);
        } catch {
          return { type: 'failed', message };
        }
        if (found === note) {
          own.add(path);
          dirty.delete(path);
        } else if (note.startsWith(found)) return { type: 'failed', message, partial: true };
        else if (core.noteIdentities(found).includes(book.id)) return { type: 'existing' };
        else return { type: 'conflict' };
      }
      learn(path, [book.id]);
      return { type: 'created' };
    };

    let done = 0;
    try {
      if (!(await adapter.exists(plan.library))) {
        try {
          await vault.createFolder(plan.library);
        } catch (error) {
          if (!(await adapter.exists(plan.library))) throw error;
        }
      }
      for (const book of plan.fresh) {
        if (run.stopping) break;
        const name = plan.names.get(book.id);
        let outcome;
        try {
          outcome = await createNote(book, name);
        } catch (error) {
          outcome = { type: 'failed', message: String(error?.message ?? error) };
        }
        if (outcome.type === 'created') result.created.push(name);
        else if (outcome.type === 'existing') result.existing.push(name);
        else if (outcome.type === 'conflict') result.conflicts.push(name);
        else result.failed.push({ name, message: outcome.message, partial: !!outcome.partial });
        run.done = ++done;
        announce();
      }
    } catch (error) {
      result.error = String(error?.message ?? error);
    } finally {
      for (const ref of refs) vault.offref(ref);
    }
    result.notAttempted = result.total - done;
    result.stopped = run.stopping && result.notAttempted > 0;
    return result;
  };

  // ---- Sessions ------------------------------------------------------------------------------
  // A session is the state of one import view: the chosen file and its preview.
  //   source  { name, size, read() }: read() returns the text of the file as it is now
  //   finished(result)  called when a run of this session ends, even after the view was closed
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

  const createSession = ({ finished } = {}) => {
    const listeners = new Set();
    let token = 0;
    let closed = false;
    let source = null;
    const notify = () => {
      for (const listener of [...listeners]) listener();
    };
    const reset = (state) =>
      Object.assign(session, { state, file: null, plan: null, error: null, stale: false });
    const readSource = async () => {
      try {
        return await source.read();
      } catch (error) {
        throw new ImportError('unreadable', { message: String(error?.message ?? error) });
      }
    };

    const session = {
      state: 'idle', // idle | reading | preview | error
      file: null, // { name, size }
      plan: null,
      error: null, // { code, details }
      stale: false, // the plan was recalculated at confirmation and needs a new one
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },

      // Reads the file and builds the preview. Creates nothing in the vault.
      async load(next) {
        if (closed || shared.run?.session === session) return;
        const mine = ++token;
        source = next;
        reset('reading');
        session.file = { name: next.name, size: next.size };
        notify();
        try {
          if (next.size > LIMITS.fileBytes)
            throw new core.CsvError('tooLarge', { limit: LIMITS.fileBytes });
          await pause(); // let the page show that the file is being read
          const plan = await build(await readSource());
          if (mine !== token) return;
          session.plan = plan;
          session.state = 'preview';
        } catch (error) {
          if (mine !== token) return;
          session.state = 'error';
          session.error = describe(error);
        }
        notify();
      },

      // Runs the previewed plan. Returns "busy" when another run holds the lock, "stale" when the
      // file, the settings or the library changed (the new plan is shown and must be confirmed
      // again), "error", or "done".
      async confirm() {
        if (closed || session.state !== 'preview' || !session.plan.fresh.length) return 'idle';
        if (shared.run) return 'busy';
        const run = { session, phase: 'checking', file: session.file.name, total: 0, done: 0 };
        run.stopping = false;
        shared.run = run; // taken before the first await: this is the lock
        const mine = ++token;
        announce();
        let result = null;
        let outcome = 'done';
        try {
          const current = await build(await readSource());
          if (signature(current) !== signature(session.plan)) {
            if (mine === token) Object.assign(session, { plan: current, stale: true });
            outcome = 'stale';
          } else {
            run.phase = 'writing';
            run.total = current.fresh.length;
            announce();
            result = await write(current, run);
          }
        } catch (error) {
          if (mine === token) Object.assign(session, { state: 'error', error: describe(error) });
          outcome = 'error';
        } finally {
          shared.run = null;
          if (result) shared.last = result;
          announce();
          notify();
        }
        if (!result) return outcome;
        try {
          finished?.(result);
        } catch {
          // A notice that cannot be shown must not hide the result.
        }
        // Show what is left to import, from the library as it is after the run.
        if (!closed && mine === token) await session.load(source);
        return outcome;
      },

      // Closes the preview and frees the file and the plan.
      clear() {
        if (shared.run?.session === session) return;
        token++;
        source = null;
        reset('idle');
        notify();
      },

      // The view is gone. A run that has started goes on to its end; its result stays in `last`.
      close() {
        closed = true;
        token++;
        source = null;
        listeners.clear();
        reset('idle');
      },
    };
    return session;
  };

  return {
    shared,
    LIMITS,
    createSession,
    subscribe(listener) {
      shared.listeners.add(listener);
      return () => shared.listeners.delete(listener);
    },
    // Stops the run after the note that is being created.
    stop() {
      if (!shared.run || shared.run.stopping) return;
      shared.run.stopping = true;
      announce();
    },
    dismiss() {
      shared.last = null;
      announce();
    },
  };
};

return { create };
