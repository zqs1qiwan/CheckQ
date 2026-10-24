# CheckQ Pick Panel — session-verified details (2026-10-05)

End-to-end verification record for the Pick Panel ("点选即逻辑", PRD §4.0). Replace prose
claims in SKILL.md when this file becomes stale.

## Verified working chain (automated, via CDP frame injection)

1. Run the flow in the editor → RunDrawer opens with step logs.
2. Click `.step-head` (first) via DOM `.click()` → `.step-detail` appears **on the next CDP call**
   (React commits async; the same-call DOM check shows stale state).
3. In a follow-up call, find the ✦ button inside `detail.querySelectorAll('button')`
   (text includes 点选) and `.click()` it → `.pick-panel` renders **on the next call**.
4. The panel contains `.json-leaf` elements (JSON response) — `.click()` the desired leaf
   → `.pick-popover` renders **on the next call**, with:
   - `.pick-preview` text like `slideshow.title = "Sample Slide Show"`
   - one `input` (variable name, prefilled by `suggestVarName`)
   - four buttons: 存为变量 / 断言成功 / 记录到日志 / 加进通知
5. Set the variable name using the native setter + input event (React-controlled input):
   ```js
   const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
   setter.call(input, 'showTitle');
   input.dispatchEvent(new Event('input', { bubbles: true }));
   ```
6. Click 存为变量 → the canvas grows a new node `提取 showTitle` (type extract)
   and the panel closes.

## Persistence proof (flows.json after the chain, post-fix)

```json
nodes: n1(http) / n2(log) / <generated>(extract "提取 showTitle", genBy: "pick")
edges: n1→n2 (sourceHandle success), n2→<generated> (sourceHandle next)
```

Generated extract config: `{ mode: 'json', path: 'slideshow.title', name: 'showTitle', optional: false }`.

## Engine execution proof (post sourceHandle fix, commit 6813a9e)

Re-running the flow after picking:

```
status: success
  1 req   -> 200 OK
  2 log   -> done
  3 提取 showTitle -> showTitle = Sample Slide Show
vars: { 'showTitle': 'Sample Slide Show' }
```

## The sourceHandle bug and its fix (RESOLVED, commit 6813a9e)

**Original bug**: pick-generated edges were created with a sourceHandle based on the NEW node
type (`extract`/`notify` → `next`, else `success`). Two failure modes:
1. Edge from http → new node with `sourceHandle: 'next'`: the engine resolves an http success
   outcome via the `success` handle, so the new node is never executed (silent dead branch).
2. Edge from http → new node with `sourceHandle: 'success'` when the http node ALREADY has a
   `success` edge (e.g. to a log node): `nextNodeId` returns only the FIRST match, so again
   the new node is unreachable.

**Fix in FlowEditor `handlePickResponse`** (commit 6813a9e):
- Choose the edge `sourceHandle` by SOURCE node type: http → `success`, condition → `true`,
  others → `next`.
- Walk the chain from the responding node along default-out edges (http→success,
  condition→true, others→next, guarding with a `seen` set) to find the TAIL node, and attach
  the new nodes to the tail instead of forking from the source.

## Related fixes shipped in this round

- `FlowEditor.jsx` node serialization on save was dropping `genBy` — added
  `genBy: n.data.genBy` to the `api.updateFlow` payload. Before this fix, any second save
  stripped `genBy: 'pick'` provenance from previously generated nodes.
- **Template boundary drops `flow.log` (fixed in b267f17)**: `save-as-template` (api.js)
  sent only `vars/nodes/edges`, and `instantiateTemplate` (store.js) copied the same three —
  a template created from a flow with log config silently lost `level`/`keywords`, and every
  task instantiated from that template had none. Fix: pass `log: f.log` in createTemplate
  and `log: tpl.log` in instantiateTemplate. General rule: any new flow-level field must be
  added at BOTH template boundary points, not just createFlow.

## Post-round state (b267f17)

- 15 commits on main; 32/32 tests still pass after the template-boundary fix.
- Test instance cleaned up: port 19997 processes killed, `/tmp/cq-verify`, `/tmp/cq-*` files,
  and one-off scripts removed; production 18888 verified healthy and untouched throughout.

## CDP access recipe (condensed)

- `browser_navigate` to `http://192.168.2.1:<port>/` (localhost unreachable from the browser sandbox).
- `browser_snapshot` → read `frame_tree.top.frame_id`.
- `browser_cdp(method='Runtime.evaluate', frame_id=<id>, params={expression, returnByValue:true})`.
- One call = one click, observe in the next call. Keep expressions short.
- If "No CDP supervisor is attached": re-run `browser_navigate`, re-acquire frame_id.
- Login automation: target the correct input by type (the page may also contain a file input —
  setting `value` on a file input throws `InvalidStateError`), use the native setter + input
  event, then `.click()` the 进入 button.
- After re-running the flow via the UI, verify persisted state directly on disk
  (`/tmp/<DATA_DIR>/flows.json`) and engine execution via curl `POST /api/flows/<id>/run`.

## Docker build note (2026-10-05)

`docker build` fails on the cross-package import in PickPanel
(`import ... from '../../../server/src/text-regex.js'`) with "Could not resolve" because the
webbuild stage only has `COPY web/`. The Dockerfile now carries
`COPY server/src/text-regex.js /server/src/text-regex.js` inside the webbuild stage. Any future
web→server relative import needs the same line (or move the module to a location inside web/).

## Password mechanism (2026-10-05)

Login password hash lives in `data/meta.json` (`passwordHash`, scrypt). `ADMIN_PASSWORD` env is
only honored on first init. To change the password on a deployed instance:
`docker exec checkq node -e "import('/app/src/store.js').then(({hashPwd}) => {...})"` writing
`meta.passwordHash = hashPwd(newpw)`, then `docker restart checkq` (in-memory Store would
otherwise overwrite the file). Current 18888 password: `<TEST_PASSWORD>`.
