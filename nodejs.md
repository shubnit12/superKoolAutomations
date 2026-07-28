# Node.js Interview Prep — Complete Q&A Reference

**Prepared for:** Shubnit • **Last updated:** 28 Jul 2026
**Format:** Every question is followed by a concise, spoken-style answer — what you'd actually say out loud in an interview. Code is included only where interviewers expect you to write or read it.
**Pending:** A JD-specific section will be appended once the job description is available.

**How a typical 1-hour round flows:** ~5 min intro & your background → ~20 min core Node/JS concepts (event loop, async, streams) → ~15 min practical (API design, DB, security, scaling) → ~15 min one coding exercise → ~5 min your questions. This document covers far more than one hour needs — it's your permanent reference.

---

## Table of Contents

1. Node.js Fundamentals & Architecture
2. Core JavaScript for Node Interviews
3. The Event Loop (Deep Dive)
4. Asynchronous Patterns & Promises
5. Streams & Buffers
6. EventEmitter
7. Modules: CommonJS vs ESM, npm
8. Express & REST API Design
9. Authentication & Security
10. Scaling, Performance & Process Management
11. Databases from Node.js
12. Queues & Background Jobs
13. Error Handling & Graceful Shutdown
14. Testing
15. TypeScript in Node.js
16. Coding Questions (with full solutions)
17. System Design Scenarios
18. Rapid-Fire One-Liners
19. Your Experience: Likely Follow-Ups & Questions to Ask

---

## 1. Node.js Fundamentals & Architecture

### What is Node.js?
Node.js is a JavaScript runtime built on Chrome's V8 engine that runs JS outside the browser. Its defining trait is an event-driven, non-blocking I/O model: a single JS thread handles many concurrent connections by delegating I/O to the system and reacting to completion events, instead of dedicating a thread per request. That makes it excellent for I/O-heavy workloads (APIs, real-time apps, proxies) and weak for CPU-heavy work.

### What are V8 and libuv, and what does each do?
V8 is the JS engine: it JIT-compiles JavaScript to machine code and manages the heap/garbage collection. libuv is a C library that gives Node its event loop, async I/O abstractions across operating systems, and a worker thread pool. Roughly: V8 executes your code, libuv makes it asynchronous.

### Is Node.js single-threaded?
Your JavaScript executes on a single thread (the event loop), but Node itself is not. libuv keeps a thread pool (default 4 threads, configurable via `UV_THREADPOOL_SIZE`, max 1024) for operations that can't be done asynchronously at the OS level — `fs`, `dns.lookup`, `crypto.pbkdf2`/`scrypt`, `zlib`. Network sockets don't use the pool at all; they use the OS's async notification mechanisms (epoll on Linux, kqueue on macOS, IOCP on Windows). And `worker_threads` gives you true JS parallelism when you need it.

### Which operations use the libuv thread pool vs OS async I/O?
Thread pool: file system calls, `dns.lookup`, CPU-ish crypto (`pbkdf2`, `scrypt`, `randomBytes` async), `zlib` compression. OS async (no threads): TCP/UDP sockets, HTTP, pipes. Interview nuance: `dns.lookup` uses the thread pool (it calls the OS resolver), while `dns.resolve` uses the c-ares library over the network — so heavy `dns.lookup` traffic can exhaust the 4-thread pool and stall file I/O too.

### How does Node handle thousands of concurrent connections with one thread?
Because the thread never waits. Each request's I/O (DB query, file read, network call) is handed off; the callback/promise resumes only when the result is ready. The single thread just multiplexes between ready callbacks. The cost model: concurrency is cheap as long as each callback's CPU work is small — one slow synchronous callback delays *everyone*.

### When is Node.js a poor choice?
CPU-bound workloads: image/video processing, heavy encryption, large in-memory computation, ML inference. A long computation blocks the event loop and freezes all requests. Mitigations if you must: `worker_threads`, chunking work with `setImmediate`, or offloading to a queue/worker service — but a language with real threads or a dedicated service is often cleaner.

### What is the difference between Node.js and browser JavaScript?
Same language, different host environments. Browser gives DOM, `window`, `fetch`/storage APIs, and sandboxing. Node gives `process`, `fs`, `net`, `Buffer`, native module systems, and full OS access. Globals differ (`window` vs `globalThis`/`global`), and module loading differs (script tags/ESM vs CJS+ESM).

### What is `process`? Name things you use it for.
A global object representing the current OS process. Common uses: `process.env` (config), `process.argv` (CLI args), `process.exit(code)`, `process.cwd()`, signal handling (`process.on('SIGTERM')`), `process.nextTick`, and crash hooks (`process.on('uncaughtException')`).

### What is the REPL?
Read-Eval-Print Loop — the interactive shell you get by running `node` with no file. Useful for quick experiments; `_` holds the last result; `.load`/`.save` work with files.

### What's the difference between `npm install` and `npm ci`?
`npm install` resolves versions from `package.json` (respecting ranges) and updates the lockfile if needed. `npm ci` is for automation: it deletes `node_modules`, installs *exactly* what `package-lock.json` says, and fails if the lockfile and `package.json` disagree. CI/CD and Docker builds should always use `npm ci` for reproducibility and speed.

### Explain semver and what `^` and `~` mean.
Versions are MAJOR.MINOR.PATCH — major = breaking changes, minor = backward-compatible features, patch = fixes. `^1.2.3` allows `>=1.2.3 <2.0.0` (minor+patch updates). `~1.2.3` allows `>=1.2.3 <1.3.0` (patch only). For `0.x` versions, `^` only allows patch updates because 0.x minors are treated as breaking.

### What is package-lock.json and should it be committed?
It records the exact resolved version, registry URL, and integrity hash of every package in the tree, so every machine installs an identical dependency graph. Yes — always commit it. It's also a supply-chain defense: integrity hashes detect tampered packages.

### dependencies vs devDependencies vs peerDependencies?
`dependencies`: needed at runtime. `devDependencies`: needed only to build/test (TypeScript, Jest, ESLint) — excluded with `npm ci --omit=dev`. `peerDependencies`: "I expect the host project to provide this" — typical for plugins (e.g., an ESLint plugin declares ESLint as a peer) to avoid duplicate copies.

### How does Node resolve `require('foo')`?
Order: core modules first (`fs`, `path`), then if the specifier starts with `./`, `../`, or `/` it's resolved as a file/directory path (trying extensions `.js`, `.json`, `.node`, then `index.js` in a directory), otherwise Node walks up the directory tree checking each `node_modules` folder until the filesystem root. The `main`/`exports` field of the package's `package.json` decides the entry file.

### What is npx?
A runner for package binaries. It executes a CLI from local `node_modules/.bin` if present, or downloads it temporarily — so you can run `npx playwright install` or `npx create-react-app` without global installs polluting your machine.

---

## 2. Core JavaScript for Node Interviews

*This section is intentionally more detailed than the rest of the document — these fundamentals are where interviewers dig deepest and chain follow-up questions. Each topic: concept → small example → the trap they'll probe.*

### var vs let vs const?
Three differences matter: **scope**, **hoisting behavior**, and **reassignment**.

**Scope** — `var` is function-scoped; `let`/`const` are block-scoped (any `{ }`):
```js
function demo() {
  if (true) {
    var a = 1;
    let b = 2;
  }
  console.log(a); // 1 — var ignores the block, lives in the whole function
  console.log(b); // ReferenceError — b existed only inside the if-block
}
```

**Hoisting** — `var` is hoisted *and initialized* to `undefined`; `let`/`const` are hoisted but left uninitialized in the **temporal dead zone (TDZ)** until their declaration line:
```js
console.log(x); // undefined  (no error — var was pre-initialized)
var x = 5;
console.log(y); // ReferenceError: Cannot access 'y' before initialization (TDZ)
let y = 5;
```

**Reassignment** — `const` locks the *binding*, not the value. The object it points to stays mutable:
```js
const user = { name: 'A' };
user.name = 'B';   // ✅ fine — mutating the object
user = {};         // ❌ TypeError — reassigning the binding
const nums = [1];
nums.push(2);      // ✅ fine
// Need real immutability? Object.freeze(user) — but it's shallow.
```
Two extra nuances worth dropping: `var` allows silent redeclaration in the same scope (`let` throws), and in Node a top-level `var` stays inside the module (module code has its own scope) — it does **not** become a global, unlike `var` in a classic browser script. Rule: default to `const`, use `let` when you must reassign, never `var`.

### What is hoisting?
Before executing your code, the engine does a registration pass over each scope: declarations are recorded up front, which is why some names "exist" before their line. What differs is *how much* of them exists:

```js
sayHi();  // ✅ "hi" — function DECLARATIONS are hoisted with their body
function sayHi() { console.log('hi'); }

sayBye(); // ❌ TypeError: sayBye is not a function
var sayBye = function () {};
// `sayBye` the VARIABLE was hoisted (as undefined); the function is only
// assigned when execution reaches that line — so you called undefined.

greet();  // ❌ ReferenceError — TDZ
const greet = () => {};
```
So: function declarations → fully usable early; `var` → exists as `undefined`; `let`/`const`/`class` → exist but untouchable (TDZ). Classes behave like `let`: `new A()` before `class A {}` throws. The interview probe is almost always the middle case — "why TypeError and not ReferenceError?" — because the variable *does* exist, it's just `undefined`.

### Explain closures (with examples).
A closure is a function bundled with its lexical scope: it keeps *live access* to the variables of the scope where it was defined, even after that scope's function has returned. The engine keeps those variables alive as long as some function still references them.

**Use 1 — private state (the classic):**
```js
function createWallet() {
  let balance = 0;                       // invisible from outside
  return {
    deposit(amt) { balance += amt; return balance; },
    getBalance() { return balance; }
  };
}
const w = createWallet();
w.deposit(100);   // 100
w.balance;        // undefined — no way to touch it except through the methods
```

**Use 2 — function factories:**
```js
const multiplier = x => y => x * y;
const double = multiplier(2);   // `x = 2` captured in the closure
double(5);                      // 10
```

**Use 3 — memoization:** the cache `Map` lives in the closure, private to the memoized function (full implementation in Section 16).

**The pitfall — accidental memory retention.** A closure keeps *everything it references* alive:
```js
function attach(bigData) {           // bigData: 200 MB
  server.on('request', () => console.log(bigData.length));
  // this listener pins ALL of bigData in memory for the server's lifetime
}
// Fix: capture only what you need
function attach(bigData) {
  const len = bigData.length;
  server.on('request', () => console.log(len));
}
```
Closures are the mechanism behind callbacks "remembering" request context, module patterns, and half the leak reports in long-running Node processes — being able to say both sides is what makes the answer senior.

### How does `this` work in JavaScript?
`this` is bound at **call time**, by how the function is invoked — not where it was written. The rules in priority order: `new` → explicit (`call/apply/bind`) → method call (`obj.fn()`) → plain call (`undefined` in strict mode — and ES modules/classes are automatically strict — else the global object). Arrow functions opt out entirely: they capture `this` lexically from the enclosing scope.

The classic "losing `this`" demo — walk through every line:
```js
const user = {
  name: 'Ada',
  hello() { console.log(this?.name); }
};

user.hello();               // 'Ada'      — method call: this = user
const fn = user.hello;
fn();                       // undefined  — plain call: the object link is gone
setTimeout(user.hello, 0);  // undefined  — same thing: you passed a bare function

setTimeout(() => user.hello(), 0);     // 'Ada' — arrow preserves the call site
setTimeout(user.hello.bind(user), 0);  // 'Ada' — this permanently fixed
class Btn { onClick = () => this.save(); } // class-field arrow: same fix, common in React
```
The insight to state explicitly: `user.hello` is just a function value; nothing about it "belongs" to `user`. The binding happens (or doesn't) at the moment of the call. That single sentence answers 80% of `this` questions.

### call vs apply vs bind?
All three set `this` explicitly; they differ in *when* the call happens and how arguments are passed:
```js
function intro(greeting, punct) {
  return greeting + ", I'm " + this.name + punct;
}
const p = { name: 'Ada' };

intro.call(p, 'Hi', '!');      // "Hi, I'm Ada!"  — invokes NOW, args listed
intro.apply(p, ['Hi', '!']);   // same             — invokes NOW, args as array
const bound = intro.bind(p, 'Hey');  // returns a NEW function, does not invoke
bound('?');                    // "Hey, I'm Ada?"  — 'Hey' was pre-filled (partial application)
```
Modern notes: spread has replaced most `apply` uses (`Math.max(...nums)`); `bind` remains genuinely useful for fixing callbacks and partial application. Two gotchas interviewers like: a bound function's `this` **cannot** be overridden by a later `call` (bind wins), and `bind` on an arrow function does nothing to `this` (arrows have none to rebind).

### Arrow functions vs regular functions?
Arrows differ in four ways: no own `this`, no `arguments`, no `prototype`, can't be constructors (`new`). The `this` difference is the one that decides correctness:

```js
const counter = {
  count: 0,
  badInc: () => { this.count++; },   // ❌ `this` is NOT counter — it's whatever
                                     //    `this` was outside the object literal
  goodInc() {
    setTimeout(() => this.count++, 100); // ✅ arrow inherits `this` from goodInc,
  }                                      //    which was called as counter.goodInc()
};
```
So the rule of thumb: **methods → regular (shorthand) functions; callbacks inside methods → arrows.** The other differences:
```js
function f() { return arguments.length; }  // arguments works
const g = (...args) => args.length;        // arrows use rest params instead
new (() => {})();                          // ❌ TypeError — not a constructor
```
Follow-up they may ask: "why can't arrows be methods on a Mongoose schema / event emitter that documents `this`?" — because those APIs *rely on* dynamic `this` binding, which arrows refuse.

### Explain prototypal inheritance.
Every object has a hidden link (`[[Prototype]]`, readable via `Object.getPrototypeOf`) to another object. Property lookup checks the object itself, then walks link by link until it finds the key or hits `null`. That chain **is** inheritance in JS — no classes copying anything.

```js
const animal = { eats: true };
const dog = Object.create(animal);   // dog → animal → Object.prototype → null
dog.barks = true;

dog.eats;                    // true  — found one link up the chain
dog.hasOwnProperty('eats');  // false — it's inherited, not an own property
'eats' in dog;               // true  — `in` checks the whole chain
```

The vocabulary distinction that trips people: **`Fn.prototype` vs an object's prototype.** `Fn.prototype` is the object that *future instances created with `new Fn()`* will link to; it is not Fn's own prototype link.

```js
class A { hi() { return 'hi'; } }
class B extends A {}
const b = new B();
b.hi(); // lookup: b → B.prototype → A.prototype (found here)
Object.getPrototypeOf(B.prototype) === A.prototype; // true — `extends` wired this
```
`class` is syntactic sugar over exactly this: methods live on the prototype (shared, memory-efficient — one copy for all instances), `extends` links prototypes, `super` continues lookup up the chain. Shadowing: setting `dog.eats = false` creates an *own* property that masks the inherited one — it never modifies `animal`.

### == vs === ?
`===` compares type and value with no conversion. `==` runs the abstract-equality coercion algorithm first — and its edge cases are the whole interview question:

```js
0 == ''            // true   ('' coerces to 0)
0 == '0'           // true   ('0' → 0)
'' == '0'          // false  (both strings already — compared as strings)
null == undefined  // true   (special-cased pair)
null == 0          // false  (null equals ONLY undefined under ==)
[] == false        // true   ([] → '' → 0, false → 0)
'5' === 5          // false  (different types, no coercion)
```
Related must-knows:
```js
NaN === NaN            // false — NaN equals nothing, even itself
Number.isNaN(x)        // the correct check
Object.is(NaN, NaN)    // true;  Object.is(0, -0) → false (=== says true)
{a:1} === {a:1}        // false — objects compare by REFERENCE, under both operators
```
Rule: always `===`. The one defensible `==` idiom is `x == null` as shorthand for "null or undefined." If asked *why* `==` exists: legacy — it predates the language having better options.

### null vs undefined?
`undefined` = the language's own "nothing here": unassigned variables, missing properties, functions without `return`, unpassed parameters. `null` = a deliberate, developer-written "empty on purpose." Two behavioral differences that make this more than trivia:

```js
function f(x = 10) { return x; }
f(undefined);  // 10   — default parameters trigger on undefined…
f(null);       // null — …but NOT on null (null is a real value you passed)

JSON.stringify({ a: undefined, b: null });
// '{"b":null}' — undefined properties are DROPPED; null survives the round-trip
```
Plus the classics: `typeof undefined` → `"undefined"`, `typeof null` → `"object"` (a permanent historical bug), and `null == undefined` is true while `null === undefined` is false. Practical convention: let the language produce `undefined`; use `null` when *you* want to signal "intentionally cleared" (e.g., in JSON APIs and DB fields, where undefined can't exist).

### Shallow vs deep copy — how do you deep clone?
A shallow copy duplicates only the first level; nested objects are still the **same references** — the source of very real production bugs:

```js
const original = { name: 'A', address: { city: 'Delhi' } };
const shallow = { ...original };            // or Object.assign({}, original)

shallow.address.city = 'Mumbai';
original.address.city;   // 'Mumbai' 😱 — both copies share one address object
```

Deep cloning options, in order of preference:
```js
// 1) structuredClone — built into Node 17+
const deep = structuredClone(original);
deep.address.city = 'Pune';
original.address.city;   // still 'Mumbai' — fully independent
// Handles: Date, Map, Set, RegExp, typed arrays, CIRCULAR references
// Doesn't handle: functions (throws), class instances lose their prototype

// 2) The old JSON hack — know its failure modes
JSON.parse(JSON.stringify({ d: new Date(), fn: () => {}, u: undefined }));
// → { d: "2026-07-28T…" }   Date became a string; function and undefined vanished
// → and it THROWS on circular references
```
Third option: a hand-written recursive clone with a `WeakMap` for circular refs — that's a coding-round favorite, and the full solution is in Section 16. Interview flow: name `structuredClone` first, then show you know exactly what the JSON hack silently destroys.

### Spread vs rest operator?
Same three dots, opposite directions — **spread expands, rest collects**:

```js
// SPREAD — unpack into a new container / a call
const merged = { ...defaults, ...userConfig };  // later keys WIN → override pattern
const copy   = [...arr];                        // shallow copy
const all    = [...listA, ...listB];            // concat
Math.max(...[3, 1, 4]);                         // 4 — array → argument list

// REST — gather leftovers into an array/object
function sum(...nums) {                         // any arity
  return nums.reduce((a, b) => a + b, 0);
}
const [first, ...others] = [1, 2, 3];           // first=1, others=[2,3]
const { password, ...safeUser } = user;         // omit a key — the standard way to
                                                // strip fields before sending a response
```
Details worth voicing: object spread copies only **own enumerable** properties (prototype/getters not carried as-is), spread copies are *shallow* (see previous question), and rest must be the **last** parameter. The `{ password, ...safeUser }` omit idiom comes up constantly in real backend code — mention it.

### `||` vs `??` (nullish coalescing)?
`||` returns the right side for **any falsy** left side — `0`, `''`, `false`, `NaN` included. `??` does it only for `null`/`undefined`. The difference is exactly the bug class where valid falsy values get stomped by defaults:

```js
const settings = { retries: 0, label: '' };

settings.retries || 3;    // 3   ❌ — 0 was a deliberate, valid value
settings.retries ?? 3;    // 0   ✅ — only null/undefined fall through
settings.label ?? 'anon'; // ''  — '' is not nullish, so it's kept
settings.timeout ??= 5000; // assignment form: set only if currently nullish
```
Mixing note: `a || b ?? c` is a SyntaxError without parentheses — the language forces you to disambiguate. Quick sibling: `&&` short-circuits the other way (`isAdmin && deleteAll()`), and `||=`/`&&=` exist alongside `??=`.

### What does optional chaining (`?.`) do?
Short-circuits to `undefined` instead of throwing when the thing before it is `null`/`undefined` — for property access, indexing, and calls:

```js
const city = user?.address?.city;   // undefined instead of
                                    // "TypeError: Cannot read properties of undefined"
user?.getProfile?.();               // call only if it exists (and user exists)
rows?.[0];                          // safe index access
```
Two precision points: it guards **only** null/undefined — if `getProfile` exists but is a string, `user.getProfile?.()` still throws (it's not a "try/catch operator"); and once the chain short-circuits, the *rest of the chain* is skipped entirely. Pairs naturally with `??` for defaults: `user?.address?.city ?? 'N/A'`. Caution to volunteer: sprinkling `?.` everywhere can hide genuine bugs — if `user` must exist at that point, letting it throw is better than silently computing with `undefined`.

### Map vs plain Object?
Both are key-value stores; Map is the purpose-built one:

```js
const m = new Map();
const keyObj = { id: 1 };

m.set(keyObj, 'metadata');   // ✅ ANY key type — objects, functions…
m.get(keyObj);               // 'metadata'   ({} keys are impossible for objects —
                             //  they'd stringify to "[object Object]")
m.size;                      // 1 — free; objects need Object.keys(o).length
for (const [k, v] of m) {}   // directly iterable, guaranteed insertion order
m.has(keyObj); m.delete(keyObj);
```
Object advantages: literal syntax, JSON support, destructuring, cheap for small fixed shapes. The serialization gotcha is a good one to volunteer:
```js
JSON.stringify(new Map([['a', 1]]));   // '{}' — Maps don't serialize!
JSON.stringify(Object.fromEntries(m)); // convert first
```
Decision rule: **Object = a record/struct with known fields; Map = a dynamic collection** (unknown/user-generated keys, frequent add/delete, non-string keys). Maps also dodge prototype-pollution-style surprises since there are no inherited keys like `constructor` lurking.

### What are WeakMap / WeakSet good for?
Their keys are held **weakly**: if the key object becomes unreachable everywhere else, the entry is garbage-collected automatically — the collection never keeps things alive. That makes them the leak-proof way to attach metadata or caches to objects you don't own:

```js
const parsed = new WeakMap();

function getParsed(req) {                 // req = incoming request object
  if (!parsed.has(req)) parsed.set(req, expensiveParse(req));
  return parsed.get(req);
}
// When the request ends and `req` is GC'd, its cache entry evaporates.
// With a regular Map, every request ever seen would stay in memory forever.
```
The constraints all follow from GC being non-deterministic: keys must be objects, and there's **no iteration, no `.size`, no `.clear`** — you can't enumerate what might vanish at any moment. WeakSet: same idea for "have I seen/processed this object?" tagging. Advanced name-drops if probed: `WeakRef` and `FinalizationRegistry` exist for manual weak references, and are almost always the wrong tool in app code.

### map / filter / reduce and friends — be fluent.
The functional array methods are assumed knowledge and show up inside every other coding answer:

```js
const orders = [
  { id: 1, amt: 10, paid: true },
  { id: 2, amt: 20, paid: false },
  { id: 3, amt: 15, paid: true },
];

orders.map(o => o.amt);                     // [10, 20, 15]     transform each
orders.filter(o => o.paid);                 // orders 1 & 3     keep matches
orders.reduce((sum, o) => sum + o.amt, 0);  // 45               fold to one value
orders.find(o => o.amt > 12);               // order 2          first match (or undefined)
orders.some(o => !o.paid);                  // true             at least one?
orders.every(o => o.paid);                  // false            all?
orders.flatMap(o => [o.id, o.amt]);         // [1,10,2,20,3,15] map + flatten(1)
```
The gotchas that separate candidates:
```js
[10, 2, 1].sort();            // [1, 10, 2] ❗ default sort is LEXICOGRAPHIC
[10, 2, 1].sort((a, b) => a - b);  // [1, 2, 10] — and sort() MUTATES the array
[].reduce((a, b) => a + b);   // ❗ TypeError — no initial value + empty array
                              //   → always pass the initial value
```
Also say: map/filter/reduce return **new** arrays (non-mutating), unlike push/splice/sort/reverse; newer runtimes add non-mutating twins (`toSorted`, `toReversed`). Chaining reads well but each link is another pass — for one hot path over a huge array, a single loop or one `reduce` is fine.

### What are generators and where are they useful?
A `function*` can pause at each `yield` and resume later, keeping its local state between calls. Calling it returns an **iterator**; each `.next()` runs to the next `yield` and hands back `{ value, done }`:

```js
function* idGen() {
  let id = 1;
  while (true) yield id++;   // infinite, but lazy — computes only when asked
}
const ids = idGen();
ids.next().value; // 1
ids.next().value; // 2   ← state (id) survived between calls
```
That's the core trick: **lazy, resumable computation** — sequences too big (or infinite) to materialize, custom iteration for your own data structures (implement `[Symbol.iterator]` with a generator), and historically the machinery async/await was built on.

The version that matters for backend work is the async generator:
```js
async function* fetchAllItems(url) {
  while (url) {
    const page = await getJson(url);   // one page at a time
    yield* page.items;                 // hand items out one by one
    url = page.nextPageUrl;
  }
}
for await (const item of fetchAllItems('/api/items')) {
  await process(item);   // next page isn't fetched until you're ready — built-in backpressure
}
```
This exact pattern — paginated APIs, DB cursors, stream consumption — is where you say generators earn their keep in real services.

### How does garbage collection work in V8?
Model: memory is freed when objects become **unreachable** from the roots (globals, the current stack, active closures). You never free memory; you drop references. V8 is generational, built on the observation that most objects die young: allocations start in a small **new space**, collected frequently by a fast copying "scavenge" (survivors get promoted); long-lived objects live in **old space**, collected by mark-sweep-compact, which modern V8 runs largely concurrently/incrementally to keep pauses short. GC pauses are a real latency factor in Node — a bloated heap means longer marking, which shows up in your p99.

So "memory leak in JS" = **unintentional reachability**. The recurring offenders, in code:
```js
// 1) Module-level cache that only grows
const cache = new Map();
app.get('/user/:id', (req, res) => {
  cache.set(req.params.id, load(req.params.id)); // never evicted → grows forever
});
// Fix: bounded LRU with eviction/TTL (implementation in Section 16)

// 2) Listener accumulation
socket.on('data', makeHandler(bigContext)); // registered per request, never removed
// Fix: pair on/off in cleanup, use once(), heed MaxListenersExceededWarning

// 3) Closures pinning large objects (see the closures question)
// 4) Forgotten timers: setInterval whose callback references a dead object
```
Ops corner: heap limits are tuned with `--max-old-space-size=<MB>` (size it below the container limit), `process.memoryUsage()` exposes heapUsed/rss, and diagnosis = heap snapshots compared over time (full workflow in Section 10). Buffers live *outside* the V8 heap ("external"), which is why RSS can be far above heapUsed in stream-heavy apps.

### What is a pure function / why does immutability matter?
Pure = two checkable properties: same inputs → same output, and **no side effects** (no mutating arguments or outer state, no I/O, no reading clocks/randomness). Purity buys you trivially easy tests (no setup/mocks), safe caching (memoization is only valid for pure functions), and code you can reorder/parallelize without fear.

```js
// Impure — mutates its input; every caller now shares the damage
function addTag(user, tag) { user.tags.push(tag); return user; }

// Pure — returns a NEW object; the original is untouched
const addTag = (user, tag) => ({ ...user, tags: [...user.tags, tag] });
```
Why immutability matters beyond style: mutation across async boundaries is a bug factory (two awaiting code paths sharing one object silently corrupt each other), reference-equality change detection (React/Redux) depends on new-object-on-change, and frozen/fresh objects make time-travel debugging and audit trails possible. Honest caveat to volunteer: copies aren't free — for a hot loop over huge arrays, controlled *local* mutation inside a function that stays pure at its boundary is the pragmatic middle ground.

### What is currying?
Transforming `f(a, b, c)` into `f(a)(b)(c)` — a chain of single-argument functions, each capturing its argument in a closure and returning the next:

```js
const add = (a, b) => a + b;
const curried = a => b => add(a, b);
curried(2)(3); // 5

// The practical shape: pre-configured helpers
const logger = level => msg => console.log('[' + level + '] ' + msg);
const warn = logger('WARN');       // level is locked in
warn('disk almost full');          // [WARN] disk almost full
warn('cert expires soon');         // reuse without repeating config
```
Distinction interviewers check: **currying** = strictly unary chain; **partial application** = fixing *some* arguments of any arity — `intro.bind(p, 'Hey')` from the bind question is partial application, not currying. Where it genuinely appears in Node code: configured middleware factories (`requireRole('admin')` returning the actual middleware), loggers, and validator builders — say those instead of abstract FP examples.

### The classic `var`-in-a-loop question.
```js
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i), 0);
// 3 3 3

for (let i = 0; i < 3; i++) setTimeout(() => console.log(i), 0);
// 0 1 2
```
Why: with `var` there is **one** shared `i` for the whole loop; the three arrow callbacks all close over that single variable, and by the time timers fire (after the loop finishes) it's 3. With `let`, the spec creates a **fresh binding per iteration**, so each callback closed over its own `i`. This one question tests closures + scoping + the event loop at once, which is why it's evergreen.

The historical fixes (know them — "how would you fix it *without* let?" is the follow-up):
```js
// 1) IIFE — create a new scope capturing the current value
for (var i = 0; i < 3; i++) {
  (function (j) { setTimeout(() => console.log(j), 0); })(i);
}
// 2) setTimeout's extra args are passed to the callback
for (var i = 0; i < 3; i++) setTimeout(j => console.log(j), 0, i);
```

---

## 3. The Event Loop (Deep Dive)

### Walk me through the event loop phases.
Each loop iteration ("tick") cycles through phases, each with its own callback queue:
1. **Timers** — expired `setTimeout`/`setInterval` callbacks.
2. **Pending callbacks** — some system-level callbacks deferred from the previous iteration (e.g., certain TCP errors).
3. **Idle/prepare** — internal.
4. **Poll** — the heart: retrieves new I/O events and runs their callbacks (fs results, incoming data). If there's nothing else scheduled, the loop can block here waiting for I/O.
5. **Check** — `setImmediate` callbacks.
6. **Close callbacks** — e.g., `socket.on('close')`.

Crucially, **after every single callback**, Node drains the `process.nextTick` queue first, then the promise microtask queue, before touching the next callback.

### Microtasks vs macrotasks?
Macrotasks are the phase queues above (timers, I/O, `setImmediate`). Microtasks are `Promise.then/catch/finally` callbacks and `queueMicrotask`. `process.nextTick` is technically a separate, even higher-priority queue. Priority between callbacks: **nextTick → promise microtasks → whatever macrotask is next**. Microtasks scheduled during microtask processing run before moving on — which is why a recursive `nextTick` or promise chain can starve I/O completely.

### process.nextTick vs setImmediate?
`process.nextTick(fn)` runs *before the event loop continues* — right after the current operation, ahead of all promises and I/O. `setImmediate(fn)` runs in the **check** phase, i.e., after the current poll phase's I/O. The names are historically backwards ("immediate" is later than "next tick"). Guidance: prefer `setImmediate` for "run this soon but let I/O breathe"; use `nextTick` sparingly (e.g., to guarantee an API emits events only after the caller has attached listeners).

### setTimeout(fn, 0) vs setImmediate — which runs first?
In the main script: **non-deterministic** — it depends on whether the ~1 ms timer threshold has elapsed by the time the loop starts, which varies with process startup load. Inside an I/O callback: **setImmediate always wins**, because after the poll phase the loop enters check (immediates) before wrapping around to timers.

```js
const fs = require('fs');
fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});
// immediate, then timeout — deterministic here
```

### Predict the output (the classic ordering puzzle).
```js
console.log('start');
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));
console.log('end');
```
Output: `start`, `end` (synchronous code first), `nextTick` (highest priority queue), `promise` (microtask), then `timeout` / `immediate` in **unguaranteed order** (main-script case above). Being able to *explain why* each line lands where it does is the real test.

### Predict the output (async/await version).
```js
async function a() {
  console.log('a start');
  await b();
  console.log('a end');
}
async function b() { console.log('b'); }

console.log('script start');
a();
Promise.resolve().then(() => console.log('promise'));
console.log('script end');
```
Output: `script start`, `a start`, `b` (async functions run synchronously until the first `await`), `script end`, `a end`, `promise`. The `await` suspends `a` and queues its continuation as a microtask — which was queued *before* the `.then`, so `a end` beats `promise`.

### Does `await` block the event loop?
No. It suspends *that async function*, returning control to the caller/event loop immediately. Everything else keeps running; the function resumes as a microtask when the awaited promise settles. What blocks the loop is synchronous CPU work — `await` is the opposite of that.

### What actually blocks the event loop? 
Synchronous APIs (`fs.readFileSync`, `crypto.pbkdf2Sync`, `child_process.execSync`), long CPU loops, `JSON.parse`/`stringify` on multi-MB payloads, and catastrophic regex backtracking (ReDoS) on user input. Symptom in production: latency spikes across *all* endpoints simultaneously, because one request's CPU work delays everyone.

### How do you detect event-loop blocking in production?
Measure event-loop lag/delay: `perf_hooks.monitorEventLoopDelay()` gives a histogram; APM tools and libraries expose "event loop utilization" (`performance.eventLoopUtilization()`). Diagnose the culprit with a CPU profile: `node --prof`, Chrome DevTools via `--inspect`, or `clinic flame` to get a flame graph.

### How do you fix event-loop blocking?
Options in order of preference: (1) don't do the work on the loop — offload CPU-bound tasks to `worker_threads` or a background job queue; (2) stream instead of buffering (process data chunk-by-chunk); (3) partition long computations into slices yielded with `setImmediate` between chunks; (4) replace sync APIs with async equivalents; (5) validate/limit input size before parsing.

### Are setTimeout delays exact?
No — the delay is a *minimum*. The callback runs in the first timers phase after the delay has elapsed and the loop is free. Heavy load pushes timers late. Also, `setTimeout(fn, 0)` is internally clamped to ~1 ms.

---

## 4. Asynchronous Patterns & Promises

### What is the error-first callback convention?
Node's original async pattern: the callback's first parameter is the error (or `null`), results follow — `fn(args, (err, data) => {...})`. Every consumer must check `err` first. Its weaknesses (deep nesting, easy-to-forget error checks, no composition) are what promises solved.

### What is callback hell and how do you avoid it?
Deeply nested callbacks where each async step indents further, tangling control flow and error handling. Fixes: promises + chaining, `async/await` (the modern answer), `util.promisify` for legacy APIs, and breaking logic into small named functions.

### Explain promise states.
A promise is pending until it settles — either fulfilled with a value or rejected with a reason. Settling is **one-time and immutable**: extra `resolve`/`reject` calls are ignored. `.then` handlers attached *after* settlement still run (with the stored result) — promises don't "miss" like events can.

### How does promise chaining work?
Each `.then` returns a *new* promise. Return a value → next `.then` gets it; return a promise → the chain waits for it and adopts its result; throw → the chain jumps to the nearest `.catch`. Errors propagate down the chain until handled, and `.finally` runs either way without changing the value.

### Promise.all vs allSettled vs race vs any?
- **all**: waits for all; results in input order; **rejects immediately** on the first rejection (fail-fast). Note: the other promises keep running — they're just ignored.
- **allSettled**: always waits for all; returns `{status, value|reason}` per item — right choice for independent operations where partial failure is fine.
- **race**: settles with the **first to settle**, fulfilled *or* rejected — classic for timeouts.
- **any**: fulfills with the **first fulfillment**; rejects with `AggregateError` only if *all* reject — "first success wins" (fallback endpoints).

### Sequential vs parallel await — the classic mistake.
```js
// Sequential — 2s total, usually wrong for independent calls
const a = await fetchA(); // 1s
const b = await fetchB(); // 1s

// Parallel — ~1s total
const [a, b] = await Promise.all([fetchA(), fetchB()]);
```
Same trap in loops: `for (const id of ids) await fetch(id)` is serial. Use `Promise.all(ids.map(fetch))` — or a concurrency limiter (Section 16) when hammering a DB/API with 10,000 parallel calls would be its own problem.

### How do you add a timeout to a promise?
`Promise.race` it against a timer:
```js
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))]);
```
Mention `AbortController` as the *cleaner* version — racing only abandons the result; aborting actually cancels the underlying operation (`fetch(url, { signal })`, and Node timers/streams accept signals too).

### What is a "floating" promise and why is it dangerous?
A promise you neither `await` nor `.catch` — fire-and-forget. Dangers: rejections become `unhandledRejection` events (which can crash the process), errors vanish silently, and work completes after the caller thinks it's done (e.g., after the HTTP response was sent). Lint rule `no-floating-promises` exists precisely for this. If fire-and-forget is intentional, attach a `.catch(log)`.

### async/await error handling — the patterns.
`try/catch` around awaits is the standard. For per-call granularity without nesting: `const [err, data] = await fn().then(d => [null, d], e => [e, null])`. In Express 4, an async handler's rejection must reach `next(err)` (wrapper or try/catch) or the request hangs; Express 5 forwards rejected promises to error middleware automatically.

### unhandledRejection vs uncaughtException?
`uncaughtException` = a synchronous throw nobody caught — the process is in an unknown state; log, clean up, **exit(1)** and let PM2/Kubernetes restart. `unhandledRejection` = a rejected promise with no handler; modern Node's default is to crash the process too. Best practice: register both hooks to log context and exit deliberately — never swallow and continue.

### What does util.promisify do?
Wraps an error-first-callback function into a promise-returning one: `const readFile = promisify(fs.readFile)`. It relies on the `(err, result)` convention. (Writing it from scratch is a common coding task — solution in Section 16.)

### What are async iterators / for await...of?
The async counterpart of iteration: the source yields promises and `for await...of` awaits each. It's how you consume streams line-by-line, paginated APIs, or any `async function*` generator — with backpressure for free, since the next chunk isn't requested until you finish the current one.

### What is an AbortController?
A standard cancellation primitive: create a controller, pass `controller.signal` to APIs (`fetch`, `setTimeout` via `timers/promises`, streams, `child_process`), call `controller.abort()` to cancel — the operation rejects with an `AbortError`. Use it for user-cancelled requests, shutdown cleanup, and timeout enforcement.

---

## 5. Streams & Buffers

### What are streams and why do they matter?
Abstractions for processing data in chunks as it arrives instead of loading everything into memory. Benefits: constant memory usage regardless of data size, earlier time-to-first-byte, and composability (pipe stages together like Unix pipes). HTTP requests/responses, sockets, file handles, and zlib are all streams.

### Name the four stream types.
**Readable** (source — `fs.createReadStream`, HTTP request on the server), **Writable** (sink — `fs.createWriteStream`, HTTP response), **Duplex** (both, independent directions — TCP socket), **Transform** (duplex where output is computed from input — `zlib.createGzip`, crypto ciphers, your own parsers).

### Flowing vs paused mode?
Readables start paused. Attaching a `'data'` listener or piping switches to flowing (data pushed as fast as possible). In paused mode you pull explicitly with `stream.read()` on `'readable'` events. Practically: use `pipeline` or `for await...of` and let Node manage modes for you.

### What is backpressure and how is it handled?
The mismatch when a fast producer outruns a slow consumer — unchecked, chunks pile up in memory and the process balloons. Mechanism: `writable.write(chunk)` returns `false` when its internal buffer exceeds `highWaterMark`; the producer should stop and resume on the `'drain'` event. `pipe()`/`pipeline()` implement this pause/resume handshake automatically — which is the answer to "why not just write in a loop?"

### pipe() vs pipeline() — which and why?
`pipeline(src, ...transforms, dest, cb)` (or the promise version from `stream/promises`) propagates **errors** from any stage, destroys all streams on failure, and tells you when everything finished. Bare `.pipe()` does none of that — an error mid-chain leaks file descriptors and hangs silently unless you hand-wire error listeners on every stream. Production answer: always `pipeline`.

### How would you process a 10 GB file without exhausting memory?
Never `fs.readFile`. Stream it:
```js
const { pipeline } = require('stream/promises');
const { createReadStream, createWriteStream } = require('fs');
const { createGzip } = require('zlib');

await pipeline(
  createReadStream('huge.log'),
  createGzip(),
  createWriteStream('huge.log.gz')
);
```
Memory stays at ~`highWaterMark` (default 64 KB for fs streams) no matter the file size. For line-based processing, wrap the read stream in `readline.createInterface` and `for await` the lines.

### How do you write a custom Transform stream?
```js
const { Transform } = require('stream');
const upper = new Transform({
  transform(chunk, encoding, callback) {
    callback(null, chunk.toString().toUpperCase());
  }
});
```
`transform(chunk, enc, cb)` receives each chunk; push output via `cb(null, data)` (or `this.push()` multiple times). Add `flush(cb)` for end-of-stream output. This is the building block for CSV parsers, encryption stages, chunk-hashing, etc.

### What is a Buffer?
Node's type for raw binary data — a fixed-length byte sequence allocated *outside* the V8 heap. Create with `Buffer.from(string/array)` or `Buffer.alloc(size)` (zero-filled). `Buffer.allocUnsafe` skips zero-filling for speed but may contain old memory — only use it if you overwrite fully. Convert with `buf.toString('utf8' | 'hex' | 'base64')`. File and socket chunks arrive as Buffers unless you set an encoding.

### What is highWaterMark?
The buffering threshold per stream: how many bytes (or objects, in objectMode) the internal buffer holds before `write()` returns false / the readable stops pulling from the source. It's a knob for the throughput-vs-memory tradeoff — bigger = fewer pauses, more RAM.

### What is objectMode?
Streams normally carry Buffers/strings; `objectMode: true` lets each chunk be an arbitrary JS object, with `highWaterMark` counted in objects (default 16). It's how parse pipelines work: bytes → Transform(csv-parse, objectMode out) → rows as objects → your business logic.

### How do streams show up in HTTP?
`req` is a Readable (upload body), `res` is a Writable. So a file download is `pipeline(createReadStream(path), res)` and a proxied upload can go `pipeline(req, transformOrValidate, s3UploadStream)` — no buffering the whole payload. This is exactly the pattern behind chunked/resumable upload systems (you've built one — say so).

---

## 6. EventEmitter

### What is EventEmitter and how does it work?
The pub/sub primitive underlying most of Node core (streams, servers, `process`). `emitter.on(event, fn)` registers listeners; `emitter.emit(event, ...args)` calls them **synchronously, in registration order**, passing the args. `once()` auto-removes after the first call; `off()/removeListener()` deregisters.

### Is emit synchronous or asynchronous?
Synchronous — by the time `emit()` returns, every listener has run. That matters: a slow listener blocks the emitter, and thrown errors in listeners propagate to the `emit` call site. If you want async handling, the listener itself should schedule work (`setImmediate`, enqueue a job).

### What is special about the 'error' event?
If an EventEmitter emits `'error'` and **no listener** is attached, Node throws the error, typically crashing the process. So long-lived emitters (servers, sockets, streams) must always have an `'error'` handler — the number-one cause of mystery crashes in stream code that uses bare `.pipe()`.

### What is the MaxListenersExceededWarning?
A leak *warning* (not an error) when more than 10 listeners are attached for one event on one emitter — default threshold via `emitter.setMaxListeners(n)`. The usual real bug: attaching a listener inside a per-request or loop code path and never removing it, so listeners (and everything their closures capture) accumulate forever.

### How do you avoid EventEmitter memory leaks?
Pair every `on` with an `off` in cleanup paths; prefer `once` for one-shot events; attach listeners at setup time, not per-request; and treat the max-listeners warning as a bug report, not something to silence.

### EventEmitter vs Streams vs Message Queues — when each?
EventEmitter: in-process, synchronous signaling between components (no persistence, no ordering guarantees across processes). Streams: in-process *data flow* with backpressure. Message queues (BullMQ/Kafka): cross-process/cross-service communication with persistence, retries, and scaling. Saying "EventEmitter is not a job queue — events are lost if no one is listening and don't survive restarts" scores points.

---

## 7. Modules: CommonJS vs ESM, npm

### CommonJS vs ES Modules — the real differences.
CJS (`require`/`module.exports`): synchronous, resolved at *runtime* (can be conditional, dynamic paths), values are copied at require time for primitives. ESM (`import`/`export`): statically analyzed at *parse* time (enables tree-shaking and import checking), loads asynchronously, exports are **live bindings** (importers see later reassignments), supports top-level `await`. Node picks the system via `"type": "module"` in package.json or the `.mjs`/`.cjs` extension. Interop: ESM can `import` CJS; CJS historically couldn't `require` ESM (only dynamic `import()`), though recent Node versions have been enabling `require(esm)` for modules without top-level await.

### module.exports vs exports?
`exports` starts as an alias to `module.exports`. Adding properties (`exports.foo = 1`) works; **reassigning** it (`exports = {...}`) silently breaks the link — Node returns whatever `module.exports` points to. Safe rule: attach properties to `exports`, or assign the whole thing to `module.exports`.

### How does module caching work?
The first `require` of a resolved path runs the module and caches `module.exports`; subsequent requires return the cached object — module code runs **once per process**. Consequences: module scope acts as a natural singleton (DB pool in a module = shared pool), and mutating an exported object is visible everywhere. `require.cache` can be deleted per-path (test tooling does this), but that's a smell in app code.

### What happens with circular dependencies?
Node doesn't crash — the module that "closes the loop" receives a **partial** (incomplete-at-that-moment) exports object of the other module, so properties defined later are `undefined` at require time. Fixes: restructure to extract shared code into a third module, require lazily inside the function that needs it, or pass dependencies in (dependency injection).

### How do you get __dirname in ESM?
It doesn't exist there. Use `import.meta.url`:
```js
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```
(Newer Node also exposes `import.meta.dirname`.)

### What does the "exports" field in package.json do?
It defines the package's public entry points and hides everything else (deep imports of internal files fail). It also enables *conditional exports* — different files for `import` vs `require`, or node vs browser — which is how dual CJS/ESM packages ship.

---

## 8. Express & REST API Design

### What is middleware in Express?
Functions with the signature `(req, res, next)` that run in registration order for matching routes. Each one can read/mutate `req`/`res`, end the response, or call `next()` to pass control on. Everything in Express is middleware — parsing, auth, logging, routing, error handling — composed as a pipeline.

### Why does middleware order matter?
Because the pipeline runs top-down. `express.json()` must come before handlers that read `req.body`; auth must come before protected routes; the 404 catch-all goes after all routes; the error handler goes **last**. A classic bug: routes defined before the body parser see `req.body === undefined`.

### How does error-handling middleware work?
It's identified purely by arity — **four** parameters: `(err, req, res, next)`. Reach it by calling `next(err)` or throwing synchronously in a handler. Register it after all routes; map known error types to status codes there, log once, and return a sanitized body (never leak stack traces to clients).

### How do you handle errors in async route handlers?
In Express 4, a rejected promise in an async handler does **not** reach the error middleware — the request hangs. Either wrap: `const asyncH = fn => (req, res, next) => fn(req, res, next).catch(next)`, or try/catch and `next(err)`. Express 5 forwards rejections automatically. Knowing this distinction is a strong signal.

### app.use vs app.get/post?
`app.use(path, fn)` mounts middleware for **all methods** and matches path *prefixes* (`/api` matches `/api/users`). `app.get('/users', fn)` matches an exact method + path pattern. Routers (`express.Router()`) group related routes and mount under a prefix.

### req.params vs req.query vs req.body?
`params`: path placeholders (`/users/:id` → `req.params.id`). `query`: the query string (`?page=2` → `req.query.page`, always strings). `body`: the parsed payload (needs `express.json()`/`urlencoded`). Validate all three at the boundary — none are trustworthy.

### What makes an API RESTful?
Resources identified by nouns in URLs (`/orders/42`), behavior expressed via HTTP verbs, statelessness (each request carries everything needed — no server-side session affinity), proper status codes, and representations (JSON) decoupled from storage. Bonus vocabulary: idempotency and HATEOAS (know the term; say almost nobody implements it fully).

### GET/POST/PUT/PATCH/DELETE — semantics and idempotency?
GET: read, safe + idempotent. POST: create/act, **not** idempotent (two calls = two resources). PUT: full replace at a known URL, idempotent. PATCH: partial update, not guaranteed idempotent by spec. DELETE: idempotent (deleting twice leaves the same state, though the second may 404). Interviewers love: "why must PUT be idempotent and POST not?" — because PUT declares the complete final state; POST asks the server to do something.

### Which status codes do you actually use?
200 OK, 201 Created (+ `Location` header), 204 No Content (successful DELETE), 400 Bad Request (validation), 401 Unauthorized (not authenticated), 403 Forbidden (authenticated, not allowed), 404 Not Found, 409 Conflict (duplicate/version clash), 422 Unprocessable Entity (semantic validation), 429 Too Many Requests (+ `Retry-After`), 500 Internal, 502/503/504 for upstream/availability. Knowing 401-vs-403 and 400-vs-422 distinctions is the common probe.

### How do you version an API?
URL versioning (`/v1/users`) — explicit, cache-friendly, most common. Header versioning (`Accept: application/vnd.api.v2+json`) — cleaner URLs, harder to test casually. Whatever you pick: additive changes don't need a version bump; breaking changes do, with a deprecation window for the old version.

### How do you validate input?
At the boundary, with a schema library — zod/joi/express-validator — as middleware before the handler: types, ranges, formats, and **stripping unknown keys** (mass-assignment defense). Return 400/422 with field-level messages. Never trust client-side validation; it's UX, not security.

### Explain CORS.
A browser security relaxation of the same-origin policy. The *server* opts in by sending `Access-Control-Allow-Origin` (and friends) so scripts from another origin may read responses. Non-simple requests (custom headers, JSON content type, PUT/DELETE) trigger a **preflight** OPTIONS request first. Key facts: CORS is browser-enforced only (curl ignores it), it's not authentication, and `Allow-Origin: *` cannot be combined with credentials.

### How do you handle file uploads?
Small/simple: `multer` middleware (multipart parsing, size/type limits, disk or memory storage). At scale: don't buffer in the API at all — stream through to object storage, or better, issue **pre-signed URLs** so clients upload directly to S3/GCS and your API only records metadata. For very large files: chunked, resumable uploads with per-chunk hashes and server-side reassembly — describe your own storage system here.

### Offset vs cursor pagination?
Offset (`?page=3&limit=20` → `OFFSET 40`): simple, allows jumping to a page; but the DB still scans skipped rows (slow at depth) and concurrent inserts shift results (duplicates/gaps). Cursor/keyset (`?after=<lastId>` → `WHERE id > $1 ORDER BY id LIMIT 20`): stable and fast at any depth; no random page access. APIs at scale use cursors.

### Express vs Fastify vs NestJS?
Express: minimal, huge ecosystem, unopinionated — you assemble the architecture. Fastify: similar model but faster (schema-based serialization) with first-class async and plugin encapsulation. NestJS: opinionated framework *on top of* Express/Fastify — DI container, decorators, modules, TypeScript-first — shines for large teams needing structure. Answer for "which would you choose": depends on team size and conventions, not micro-benchmarks.

### REST vs GraphQL?
GraphQL: single endpoint, client declares exactly the fields it needs (kills over/under-fetching), strongly typed schema, great for diverse frontends. Costs: caching is harder (everything is POST), N+1 resolver problems (need dataloader), query-complexity abuse to guard, more server machinery. REST stays simpler for stable, resource-shaped APIs and benefits from plain HTTP caching.

### How do you secure/rate-limit an Express app quickly?
`helmet` (security headers), CORS locked to known origins, `express-rate-limit` with a Redis store (per-IP/per-user buckets), body size limits (`express.json({ limit: '100kb' })`), schema validation, and central error handling that never leaks internals. Details in Section 9.

---

## 9. Authentication & Security

### What is a JWT and what's inside it?
A signed token in three base64url parts: **header** (algorithm/type) `.` **payload** (claims: `sub`, `exp`, `iat`, roles) `.` **signature** over the first two using a secret (HS256) or private key (RS256). Critical point: JWTs are **signed, not encrypted** — anyone can decode and read the payload; the signature only proves it wasn't tampered with. Never put secrets in the payload.

### HS256 vs RS256?
HS256: one shared secret signs and verifies — fine when the issuer and verifier are the same service. RS256: private key signs, **public key** verifies — right choice when many services verify tokens (they only need the public key, often fetched from the identity provider's JWKS endpoint). This is how OIDC providers work.

### JWT vs server-side sessions?
Sessions: server stores state (memory/Redis), client holds an opaque session ID cookie — instant revocation, tiny cookie, but needs a shared session store to scale horizontally. JWT: stateless — any instance verifies with the key alone, great for scaling and cross-service auth; but **revocation is hard** (token valid until `exp`), and tokens are bigger. Standard mitigation: short-lived access tokens + refresh flow.

### Explain the refresh-token flow.
Access token lives minutes (5–15); refresh token lives days/weeks and is stored server-side (or at least tracked). When the access token expires, the client hits `/refresh` with the refresh token, gets a new pair. Security add-ons: **rotation** (each refresh invalidates the old refresh token; reuse of an old one signals theft → revoke the whole family) and storing refresh tokens in httpOnly cookies. This answers "how do you log someone out with JWTs?"

### Where should the client store tokens — localStorage or cookies?
localStorage: readable by any JS on the page → any XSS steals the token. httpOnly + Secure + SameSite cookie: JS can't read it (XSS can't exfiltrate), but auto-sending re-opens CSRF, mitigated by `SameSite=Lax/Strict` and CSRF tokens. Interview-safe answer: httpOnly secure cookies for browser apps, with CSRF defenses; `Authorization: Bearer` headers for pure API/service-to-service clients.

### OAuth 2.0 vs OpenID Connect?
OAuth 2.0 is **authorization** — delegated access to resources ("this app may read your calendar") via access tokens. OIDC is an **identity layer on top of OAuth** — adds the `id_token` (a JWT describing *who* logged in), the `/userinfo` endpoint, and discovery. "Login with Google" is OIDC. You implemented payroll SSO with OIDC — walk through it: authorization-code flow, redirect with `code`, backend exchanges code for tokens, validates the id_token signature (JWKS), issuer, audience, expiry, nonce.

### Why authorization-code flow with PKCE instead of implicit flow?
Implicit returned tokens in the URL fragment — leakable via history/referrers, no client authentication. Code flow keeps tokens in a back-channel exchange. PKCE adds a per-request secret (code_verifier/challenge) so an intercepted code is useless — now the recommendation for SPAs and mobile, where a static client secret can't be kept.

### How do you store passwords?
Never encrypt (reversible), never plain hash (rainbow tables). Use a **slow, salted, adaptive** password hashing function: bcrypt (cost ~10–12) or Argon2id (modern preference — memory-hard, GPU-resistant). The salt is generated per-password and stored inside the hash string. Verify by hashing the attempt and comparing. Add rate limiting/lockout for brute force.

### What is SQL injection and the defense?
Attacker input alters query structure: `WHERE name = '` + input + `'` with input `' OR 1=1 --`. Defense: **parameterized queries** — `client.query('SELECT * FROM users WHERE name = $1', [name])` — the driver sends the query plan and data separately, so input can never become syntax. ORMs/query builders parameterize by default; the danger returns with raw string-built queries. Same idea for NoSQL: reject operator-shaped input like `{ $gt: '' }` (validate types).

### What is XSS and how do you prevent it?
Injecting script that runs in *other users'* browsers (stored in DB, reflected in URLs, or DOM-based). Defenses: encode output for its context (frameworks like React escape by default — the danger is `dangerouslySetInnerHTML`), sanitize any allowed rich text (DOMPurify), set a Content-Security-Policy, and use httpOnly cookies so successful XSS can't grab tokens.

### What is CSRF and when do you need protection?
Tricking a logged-in user's browser into sending a state-changing request — it works because cookies are attached **automatically** cross-site. Defenses: `SameSite=Lax/Strict` cookies (the modern baseline), anti-CSRF tokens for forms, and re-verifying intent for sensitive actions. Key nuance: if auth travels in an `Authorization` header (not cookies), classic CSRF doesn't apply — the attacker's page can't set that header.

### What does helmet do?
Sets defensive HTTP headers in one middleware: HSTS (force HTTPS), X-Content-Type-Options: nosniff, frame-ancestors/X-Frame-Options (clickjacking), a CSP if configured, hides `X-Powered-By`, etc. One line, meaningful hardening.

### How do you rate limit and protect against brute force?
Per-key buckets (IP, user ID, API key) with a shared **Redis** store so limits hold across instances — fixed window is simplest; sliding window or token bucket is smoother (token bucket implementation in Section 16). Return 429 + `Retry-After`. For login specifically: per-account counters, exponential backoff/lockout, and generic error messages that don't reveal whether the username exists.

### How do you manage secrets?
Never in code or git. Environment variables injected at deploy time (12-factor), sourced from a secret manager (AWS Secrets Manager/SSM, Vault) in real environments; `.env` + dotenv only for local dev, with `.env` in `.gitignore`. Rotate on exposure; scope credentials minimally; don't log them.

### How do you keep dependencies safe?
Commit lockfiles, run `npm audit` (and Dependabot/Snyk) in CI, pin/review before upgrading, prefer well-maintained packages, and use `npm ci` so builds can't silently drift. Mention supply-chain awareness: typosquatting and hijacked maintainer accounts are the modern attack vector.

### What is HTTPS/TLS actually giving you?
Encryption (confidentiality), integrity (tamper detection), and server authentication via certificates. In typical deployments Node sits behind Nginx or a load balancer that **terminates TLS**; internal traffic policies decide whether to re-encrypt. Redirect HTTP→HTTPS and set HSTS.

---

## 10. Scaling, Performance & Process Management

### What is the cluster module?
It forks multiple Node processes (workers) — typically one per CPU core — that **share the same server port**. The primary process accepts connections and distributes them to workers (round-robin on Linux by default). Workers are separate processes: separate memory, no shared state — which is exactly why app state must live in Redis/DB, not in-process. Crashed workers can be re-forked, giving resilience.

### cluster vs worker_threads vs child_process?
- **cluster**: scale an HTTP server across cores — many processes, one port. For throughput of I/O-bound servers.
- **worker_threads**: real threads *inside* one process for **CPU-bound** work (parsing, crypto, image transforms); can share memory via `SharedArrayBuffer`; communicate via message passing.
- **child_process** (`spawn`/`exec`/`execFile`/`fork`): run external programs or separate Node scripts. `spawn` streams output (large output safe), `exec` buffers it via a shell (small output, shell-injection risk with user input), `fork` is spawn specialized for Node scripts with an IPC channel.

One-liner: cluster = scale the server, worker_threads = don't block the loop, child_process = run other programs.

### What does PM2 give you?
A production process manager: auto-restart on crash, `-i max` cluster mode without writing cluster code, **zero-downtime reload** (restarts workers one by one), log management, monitoring, and startup scripts. In containerized deployments, Kubernetes/ECS takes over most of these responsibilities and you often run plain `node` (one process per container, scale by replicas).

### How do you scale a Node app horizontally? What must be true first?
Run N identical instances behind a load balancer — but the app must be **stateless**: sessions in Redis (not memory), uploads to object storage (not local disk), caches shared or safely local, background jobs via a queue with locking (so N instances don't run the same cron). Then scaling is "add instances." This question is really testing whether you know the statelessness prerequisites.

### What are sticky sessions and when do you need them?
The load balancer pins a client to one instance (by cookie/IP). You need them for stateful in-memory protocols — classically Socket.IO's HTTP long-polling handshake — or legacy in-memory sessions. They're otherwise an anti-pattern (uneven load, lost state on instance death); prefer externalizing state, e.g., Socket.IO's Redis adapter for multi-instance pub/sub.

### How do you cache with Redis? Explain cache-aside.
Cache-aside (lazy loading): read → try cache → on miss, read DB, write cache with a **TTL** → return. Writes: update DB, then **invalidate** (delete) the key — safer than writing the new value (avoids races). Name the two classic problems: *stale data* (bound by TTL + invalidation on write) and *cache stampede* (a hot key expires, hundreds of requests hit the DB at once — fix with a short lock/mutex around the rebuild, or probabilistic early refresh).

### What else do you cache, and where?
Layers: HTTP caching headers/CDN for public GETs, Redis for shared hot data and computed results, in-process LRU for tiny ultra-hot lookups (accepting per-instance staleness), and DB-side (materialized views). Rule of thumb: cache the *result of expensive work*, key it precisely, and always have an invalidation story before adding a cache.

### How do you find a memory leak in Node?
Confirm: heap usage grows across GCs (`process.memoryUsage()`, dashboards) and eventually OOMs. Diagnose: take **heap snapshots** over time — start with `node --inspect`, open Chrome DevTools → Memory, snapshot at intervals, and use the *comparison view* to see which object types grow; retainer paths show what's pinning them. Usual suspects: module-level arrays/maps that only grow, event listeners never removed, closures capturing big objects, unbounded caches, forgotten timers. Fixes: bounded LRU caches, `off()` in cleanup, WeakMap for object-keyed metadata.

### How do you profile CPU?
`node --inspect` + DevTools Profiler for interactive flame charts; `node --prof` + `--prof-process` for tick logs; `clinic flame`/`0x` for one-command flame graphs. Read the flame graph for wide frames (where time actually goes) — typical wins: JSON on huge payloads, sync crypto/compression, accidental O(n²) code, chatty logging.

### How do you monitor a Node service in production?
The signals: latency percentiles (p95/p99, not averages), throughput, error rate, **event-loop lag/utilization**, heap used, GC pauses, and per-dependency timings (DB, Redis, HTTP calls). Structured logs with correlation IDs, metrics to Prometheus/Datadog-style systems, health endpoints. The Node-specific one to name is event-loop lag — it's the early-warning signal generic CPU metrics miss.

### Quick wins for Node API performance?
Reuse connections (DB pool, keep-alive HTTP agents), cache hot reads, paginate everything, stream large payloads instead of buffering, compress responses (usually at Nginx), avoid sync APIs on the request path, move heavy work to queues/workers, and add indexes for real query patterns. Measure first — the bottleneck is usually the database, not Node.

### Why put Nginx in front of Node?
TLS termination, serving static assets, gzip/brotli, buffering slow clients (protects Node from slowloris-style tie-ups), request size limits, load balancing across instances, and cheap routing. Node then does only application work. (You run Nginx on your own infra — bring that up.)

### How do you run Node well in Docker?
Multi-stage build (build stage with dev deps → slim runtime stage with `npm ci --omit=dev`), a small base image (`node:20-slim`/alpine with caveats), run as the non-root `node` user, `.dockerignore` node_modules and .git, and **run `node server.js` directly** — not `npm start`, because npm doesn't forward SIGTERM, which breaks graceful shutdown. One process per container; scale with replicas.

### What's the role of environment-based config (12-factor)?
Same build artifact runs everywhere; behavior differs only via environment variables (DB URLs, secrets, feature flags). Read env once at startup into a validated config object (zod schema on `process.env` is a nice touch) and fail fast on missing config rather than at first use in production.

---

## 11. Databases from Node.js

### Why connection pooling? How does it work?
Opening a Postgres connection costs a TCP + TLS + auth handshake and a backend process on the DB — doing that per request is slow and will exhaust the DB's `max_connections`. A pool keeps N warm connections; requests borrow one and return it. In `pg`: `pool.query()` for one-shot queries (auto checkout/return), `pool.connect()` when you need the **same client across statements** — i.e., transactions. Size the pool deliberately (instances × pool size must fit the DB limit).

### Show a correct transaction in node-postgres.
```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amt, from]);
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amt, to]);
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release(); // ALWAYS — leaked clients exhaust the pool
}
```
The three interview points: same client for all statements, ROLLBACK on error, release in `finally`.

### What is the N+1 query problem?
Fetch N parent rows, then loop making one query per row for children — N+1 round trips; fine at 10 rows, catastrophic at 10,000. Fixes: a JOIN, or batch with `WHERE parent_id = ANY($1)` and group in code, or a batching layer like dataloader (GraphQL's standard fix). Detection: query logging showing bursts of identical queries with different IDs.

### ORM vs query builder vs raw SQL?
ORM (Prisma/TypeORM/Sequelize): fastest CRUD development, migrations, type safety (Prisma especially) — at the cost of opaque generated SQL and awkward complex queries. Query builder (Knex): composable SQL in JS, closer to the metal. Raw SQL: full control and performance, more discipline required. Pragmatic answer: ORM for standard CRUD, drop to raw/builder for reports, bulk ops, and hot paths — and always be *able* to read the generated SQL.

### How do indexes work and when do you add one?
B-tree indexes let the DB seek matching rows in O(log n) instead of scanning the table; they speed up WHERE/JOIN/ORDER BY on the indexed columns and cost extra work on every write plus storage. Add them for actual query patterns (verify with `EXPLAIN ANALYZE` — look for Seq Scan on big tables). Composite indexes serve leftmost-prefix queries; don't index everything "just in case."

### SQL vs NoSQL — how do you choose?
Relational (Postgres): structured data, relationships/joins, **ACID transactions**, ad-hoc queries — the default for transactional business data (payments, payroll, claims). Document (Mongo): flexible/varied schemas, hierarchical documents read as a unit, easy horizontal sharding. Redis: in-memory structures for caching, sessions, queues, rate limiting. Strong answer: default to Postgres for systems of record; add specialized stores for the access patterns that need them.

### Optimistic vs pessimistic locking?
Pessimistic: lock the row up front (`SELECT ... FOR UPDATE`) so others wait — safe, can bottleneck. Optimistic: no lock; keep a `version` column and update with `WHERE id = $1 AND version = $2`; zero rows affected means someone else won — retry or surface a conflict (HTTP 409). Optimistic suits low-contention web workloads.

### How do you run schema migrations?
Versioned migration files in the repo (Prisma Migrate, Knex, node-pg-migrate), applied in order by CI/CD before or during deploy, each with up/down. Discipline points: never edit an applied migration, make changes **backward compatible** with the still-running old code (expand → migrate → contract) for zero-downtime deploys.

### How do you avoid storing/leaking sensitive data problems at the DB layer?
Encrypt at rest (managed DBs do this), TLS to the DB, least-privilege DB users per service, parameterized queries everywhere, and keep PII out of logs. For regulated domains (payroll, healthcare claims — relevant to this company): audit trails of who changed what, and retention/erasure policies.

### What SQL should you be ready to write live?
JOIN two tables with an aggregate + GROUP BY + HAVING; a window function (`ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)` — "latest record per group" is the classic); a CTE for readability; and explain a NULL gotcha (`NULL != NULL`; use `IS NULL`; `NOT IN` with NULLs returns nothing). You've been sharpening exactly these — trust it.

---

## 12. Queues & Background Jobs

### Why use a message/job queue at all?
To decouple "accept the request" from "do the slow work": respond in milliseconds, process (emails, PDFs, imports, payments) in the background. Queues also **absorb traffic spikes** (buffer instead of overload), give retries with backoff, isolate failures, and let you scale workers independently of the API.

### Explain BullMQ's model.
Redis-backed queues: producers `queue.add(name, data, opts)`; **Workers** process jobs with configurable `concurrency`; jobs move through waiting → active → completed/failed. Features you should name: delayed jobs, priorities, repeatable (cron-like) jobs, rate limiting, automatic retries with backoff, and events for observability. You run BullMQ in your own automation server — cite it.

### How do you guarantee a job (e.g., a payment) never runs twice?
You can't guarantee exactly-once *delivery* — a worker can crash after doing the work but before acking, so the job redelivers. So you design **at-least-once delivery + idempotent handlers**: a deterministic idempotency key (e.g., `payment:{orderId}`), and either BullMQ's `jobId` (adding a duplicate ID is a no-op) for dedup at enqueue time, plus a uniqueness check at execution time (unique DB constraint on the key, or Redis `SET key NX`) so a redelivered job detects the work was already done. This exact question is very likely at a claims/payments company.

### At-least-once vs at-most-once vs exactly-once?
At-most-once: fire and forget — may lose work. At-least-once: retry until acked — may duplicate, the practical default. Exactly-once: not achievable end-to-end across systems; you *simulate* it with at-least-once + idempotency (dedup keys, transactional outbox). Saying "exactly-once is idempotency in a trench coat" lands well.

### How do retries and dead-letter queues work?
Failed jobs retry with **exponential backoff + jitter** up to a max attempts count; beyond that they land in a failed/dead-letter set for inspection, alerting, and manual or scripted replay. Design point: distinguish retryable errors (timeouts, 5xx) from permanent ones (validation) — permanent failures should go straight to DLQ, not burn retries.

### How do you run scheduled/cron work across multiple instances?
Not `node-cron` in-process on N instances — it fires N times. Use the queue's repeatable jobs (BullMQ schedules once in Redis, one worker picks it up), or a distributed lock (Redis `SET NX PX`) around the task, or an external scheduler (Kubernetes CronJob) that enqueues.

### Redis-based queues (BullMQ) vs Kafka?
BullMQ: **job queue** semantics — a task is consumed by one worker, completed, gone. Perfect for background work. Kafka: **event log/stream** — durable, replayable, multiple independent consumer groups each see all events, high throughput, ordering per partition. Use Kafka for event-driven integration between services and audit-grade event history; BullMQ for "do this task."

---

## 13. Error Handling & Graceful Shutdown

### Operational vs programmer errors — why does the distinction matter?
Operational errors are expected runtime conditions: invalid input, DB timeout, upstream 503, file not found — **handle** them (retry, 4xx/5xx response, fallback). Programmer errors are bugs: undefined is not a function, broken invariants — the process state is untrustworthy, so **log and crash**, letting the process manager restart clean. Trying to "handle" bugs in place is how zombie processes corrupt data.

### How should uncaughtException and unhandledRejection be handled?
Register both hooks to: log the error with full context, flush logs/telemetry, attempt fast cleanup, then `process.exit(1)`. Never log-and-continue — after an uncaught exception, connections and state may be inconsistent. Recovery comes from the *orchestrator* (PM2/Kubernetes) restarting the process, not from the process limping on.

### Walk me through graceful shutdown.
On SIGTERM/SIGINT:
```js
process.on('SIGTERM', async () => {
  server.close();               // 1. stop accepting new connections (in-flight finish)
  await worker.close();         // 2. stop taking new jobs, finish current ones
  await pool.end();             // 3. close DB/Redis connections
  process.exit(0);
});
setTimeout(() => process.exit(1), 10_000).unref(); // 4. force-exit deadline
```
Order matters: stop intake first, drain, then release resources, with a hard timeout so a stuck request can't block shutdown forever. This is what makes zero-downtime deploys actually zero-downtime — and why containers must send SIGTERM to *node itself* (not npm).

### How do you design application error classes?
One `AppError extends Error` carrying `statusCode`, a stable machine-readable `code`, and `isOperational = true`; domain errors (ValidationError, NotFoundError) extend it. Central middleware maps operational errors to responses and treats everything else as a 500 + alert. Always `throw new Error(...)` (never bare strings — you lose the stack), and preserve causes (`new Error('x', { cause: err })`).

### What does good logging look like?
Structured JSON logs (pino/winston) with levels, timestamps, and a **correlation/request ID** propagated through every log line of a request (AsyncLocalStorage makes this clean) — that's what turns "an error happened" into a traceable story across services. Log errors once at the boundary (not at every layer), never log secrets/PII, and keep console.log out of hot paths (it's synchronous to a TTY).

### Liveness vs readiness health checks?
Liveness: "is the process alive?" — restart it if not. Readiness: "can it serve traffic *right now*?" — checks dependencies (DB ping, Redis) and gates load-balancer routing; failing readiness removes the instance from rotation without killing it. Conflating them causes restart storms when a dependency blips.

### A request failed in production — walk me through debugging it.
Find the request's correlation ID from the error report → pull all its logs across services → check dashboards for whether it's isolated or a pattern (error rate, latency, event-loop lag, memory) → reproduce with the captured payload in staging → read the code path → fix, add a regression test, and add the missing observability that would have made this faster. Interviewers want a *system*, not "I'd console.log."

---

## 14. Testing

### Unit vs integration vs E2E — and the pyramid.
Unit: one function/module in isolation, dependencies mocked — fast, thousands of them. Integration: real pieces together (route → service → real test DB) — slower, fewer. E2E: full user flow through the deployed stack (Playwright) — slowest, fewest, highest confidence per test. The pyramid says invest in that order; inverted pyramids (all E2E) are slow and flaky. You own Playwright suites at work — say the pyramid keeps E2E focused on critical journeys.

### What does a Jest test look like? Setup/teardown?
`describe` groups, `it/test` cases, `expect(x).toBe/ toEqual/ toThrow/ rejects` assertions. `beforeAll/afterAll` for expensive shared setup (DB connection), `beforeEach/afterEach` for per-test state reset (truncate tables, clear mocks). `toBe` = reference/primitive equality; `toEqual` = deep structural equality — a classic quick question.

### How do you test async code?
Return or `await` the promise in the test — Jest waits for it. `await expect(fn()).resolves.toEqual(...)` / `.rejects.toThrow(...)`. For timer-based code, `jest.useFakeTimers()` + `jest.advanceTimersByTime(ms)` so tests don't actually sleep — this is exactly how you test the debounce/throttle you might write in the coding round.

### Mocks, stubs, spies — and how do you mock in Jest?
Spy: records calls to a real function (`jest.spyOn(obj, 'method')`). Stub/mock: replaces the implementation (`jest.fn().mockResolvedValue(...)`, `jest.mock('./emailService')`). Mock at the *boundary* (HTTP clients, DB, mail) so units test your logic, not the network. Design note worth saying: dependency injection (passing collaborators in) makes code testable without module-mocking magic.

### How do you test an Express API?
`supertest` drives the app in-process — no port needed:
```js
const res = await request(app).post('/users').send({ name: 'A' });
expect(res.status).toBe(201);
```
For integration: real routes + real test database (dockerized Postgres), truncated between tests; mock only true externals (payment APIs). Auth: helper that mints a valid test token.

### What does code coverage tell you — and not tell you?
It tells you which lines executed during tests; it does **not** tell you whether behavior was asserted — 100% coverage with weak assertions proves nothing. Use it to find *untested areas*, not as a target to game. Reasonable gate: ~80% with mandatory coverage on money/eligibility-critical paths.

### How do you handle flaky tests?
Find the nondeterminism: shared state between tests, real timers/sleeps, order dependence, race conditions, external services. Fixes: isolate state per test, fake timers, deterministic seeds/clock injection, proper `await`s (in Playwright: web-first assertions and auto-waiting locators instead of fixed sleeps). Quarantine + fix, never `retry: 3` as a lifestyle — you can speak to this from real suite maintenance.

---

## 15. TypeScript in Node.js

### Why TypeScript for a Node backend?
Static types catch a whole error class at compile time, make refactors safe, and turn the type system into living documentation (compiler-verified contracts between layers). Cost: build step and typing effort. On any multi-person codebase the trade is decisively worth it.

### interface vs type?
Mostly interchangeable for object shapes. `interface`: extendable, supports declaration merging (why libraries use it for augmentable public APIs). `type`: also does unions (`'a' | 'b'`), intersections, mapped/conditional types, tuples, primitives. Practical rule: interface for public object contracts, type for everything else — consistency matters more than the choice.

### any vs unknown vs never?
`any` opts out of checking entirely (contagious — avoid). `unknown` is the safe top type: accepts anything but forces narrowing (typeof/instanceof/schema-parse) before use — right type for external input like `JSON.parse` results and `catch (err: unknown)`. `never` is "cannot happen": functions that always throw, and exhaustiveness checks in switch statements.

### Give a quick generics example.
```ts
function first<T>(arr: T[]): T | undefined { return arr[0]; }
async function getJson<T>(url: string): Promise<T> { /* ... */ }
```
Generics preserve type relationships through a function instead of collapsing to `any`. Constraints refine them: `<T extends { id: string }>`.

### Which utility types do you actually use?
`Partial<T>` (update DTOs), `Pick`/`Omit` (derive DTOs from entities — `Omit<User, 'passwordHash'>` for API responses), `Record<K, V>` (typed maps), `Readonly<T>`, `ReturnType<typeof fn>`. Being fluent here signals real TS usage beyond annotations.

### How does TS run in Node, and do types exist at runtime?
Types are **erased** at compile time — no runtime validation happens; that's why zod/joi still validate external input, and zod's `z.infer` derives the static type from the runtime schema (single source of truth). Execution: `tsc` build → run JS in prod; `tsx`/`ts-node` for dev; recent Node can strip types natively for simple cases. Strict mode (`"strict": true`) should be non-negotiable.

---

## 16. Coding Questions (with full solutions)

Talk while you code: state the approach, note edge cases, then write. These cover ~90% of what's asked at your level.

### Implement Promise.all from scratch.
```js
function promiseAll(promises) {
  return new Promise((resolve, reject) => {
    const results = [];
    let completed = 0;
    if (promises.length === 0) return resolve([]);
    promises.forEach((p, i) => {
      Promise.resolve(p).then(value => {       // Promise.resolve handles plain values
        results[i] = value;                     // index, not push — preserves order
        if (++completed === promises.length) resolve(results);
      }, reject);                               // first rejection wins (fail-fast)
    });
  });
}
```
Edge cases to mention: empty array resolves immediately; non-promise values; order preserved by index; counting completions (not `results.length`, which lies with sparse arrays). Follow-up they may ask: modify into `allSettled` (never reject; store `{status, value|reason}`).

### Implement util.promisify.
```js
function promisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, result) => (err ? reject(err) : resolve(result)));
    });
  };
}
// const readFile = promisify(fs.readFile);
```
Points: append the callback last, error-first convention, preserve `this` with `fn.call(this, ...)`.

### Implement sleep/delay.
```js
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await sleep(1000);
```

### Retry with exponential backoff (+ jitter).
```js
async function retry(fn, { retries = 3, baseDelay = 200, factor = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;               // out of attempts
      const delay = baseDelay * factor ** attempt + Math.random() * 100; // jitter
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```
Say why jitter exists: without it, all failed clients retry in synchronized waves (thundering herd). Real-world extension: only retry *retryable* errors (timeouts, 429, 5xx).

### Implement debounce.
```js
function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
```
Fires once, `wait` ms after the *last* call — "wait until they stop typing." Search boxes, resize handlers, autosave.

### Implement throttle.
```js
function throttle(fn, wait) {
  let last = 0, timer = null;
  return function (...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn.apply(this, args);
    } else if (!timer) {                       // trailing call so the final event isn't lost
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}
```
Fires at most once per `wait` — steady rate during continuous events (scroll, mousemove). Debounce = after silence; throttle = during noise.

### Implement an EventEmitter.
```js
class MyEmitter {
  #listeners = new Map();
  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(fn);
    return this;
  }
  once(event, fn) {
    const wrapper = (...args) => { this.off(event, wrapper); fn(...args); };
    return this.on(event, wrapper);
  }
  off(event, fn) {
    const fns = this.#listeners.get(event) || [];
    this.#listeners.set(event, fns.filter(f => f !== fn));
    return this;
  }
  emit(event, ...args) {
    const fns = [...(this.#listeners.get(event) || [])]; // copy: listeners may mutate list
    fns.forEach(fn => fn(...args));
    return fns.length > 0;
  }
}
```
Details that earn points: `once` via self-removing wrapper, copying the array before emit (an `off` during emit shouldn't skip listeners), returning `this` for chaining.

### Implement an LRU cache.
```js
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();                       // Map preserves insertion order
  }
  get(key) {
    if (!this.map.has(key)) return -1;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);                   // re-insert = mark most-recently-used
    return value;
  }
  put(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      this.map.delete(this.map.keys().next().value); // first key = least-recently-used
    }
    this.map.set(key, value);
  }
}
```
The insight to state out loud: a JS `Map` iterates in insertion order, so delete-and-reinsert gives O(1) recency tracking — no hand-rolled doubly linked list needed (mention that the classic textbook solution is hashmap + DLL).

### Implement a rate limiter (token bucket).
```js
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.last = Date.now();
  }
  allow() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}
```
Lazy refill on each check (no background timer). Capacity = burst allowance; refill rate = sustained rate. Follow-up: "across multiple servers?" → move the state to Redis with an atomic Lua script or use INCR + EXPIRE windows.

### Run async tasks with a concurrency limit (p-limit style).
```js
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;                          // claim an index
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
  return results;
}
// await mapWithConcurrency(urls, 5, fetchUrl) — never more than 5 in flight
```
The pattern: N runner loops pulling from a shared cursor. This is the grown-up answer to "Promise.all with 10,000 items would nuke the API — what do you do?"

### Implement memoize.
```js
function memoize(fn) {
  const cache = new Map();
  return function (...args) {
    const key = JSON.stringify(args);            // note: breaks on unserializable args
    if (!cache.has(key)) cache.set(key, fn.apply(this, args));
    return cache.get(key);
  };
}
```
Mention the caveats yourself: key strategy for object args, unbounded growth (combine with the LRU above), and caching rejected promises if `fn` is async (delete on rejection).

### Flatten a nested array (with depth).
```js
function flatten(arr, depth = Infinity) {
  return depth < 1
    ? arr.slice()
    : arr.reduce((acc, v) =>
        acc.concat(Array.isArray(v) ? flatten(v, depth - 1) : v), []);
}
// flatten([1, [2, [3, [4]]]], 1) → [1, 2, [3, [4]]]
```
Mention `arr.flat(depth)` exists — they want the manual version; offer the iterative stack version if they push on recursion limits.

### Deep clone (interview version).
```js
function deepClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);      // circular refs
  if (value instanceof Date) return new Date(value);
  const out = Array.isArray(value) ? [] : {};
  seen.set(value, out);
  for (const key of Object.keys(value)) out[key] = deepClone(value[key], seen);
  return out;
}
```
Lead with "in real code I'd use `structuredClone`," then write this to show you understand recursion + the WeakMap circular-reference trick.

### Process a huge CSV with streams (sum a column).
```js
const { createReadStream } = require('fs');
const { createInterface } = require('readline');

async function sumColumn(path, colIndex) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let total = 0, isHeader = true;
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    const value = Number(line.split(',')[colIndex]);
    if (!Number.isNaN(value)) total += value;
  }
  return total;
}
```
Constant memory for any file size; `for await` gives backpressure automatically. Caveat to say out loud: naive `split(',')` breaks on quoted fields — production uses `csv-parse` in a pipeline.

### Group an array of objects by a key.
```js
const groupBy = (arr, key) =>
  arr.reduce((acc, item) => {
    (acc[item[key]] ??= []).push(item);
    return acc;
  }, {});
```
Small, common warm-up; the `??=` idiom reads well. (Newer runtimes also have `Object.groupBy`.)

---

## 17. System Design Scenarios

Keep a fixed skeleton: clarify requirements & scale → API surface → data model → core flow → failure modes → scaling. Speak from what you've actually built wherever possible.

### Design a file upload service (large files, resumable).
Client requests an upload session → server returns an upload ID (and ideally pre-signed URLs). Client splits the file into chunks (e.g., 5–10 MB), uploads each with its index + hash; server (or object storage) stores chunks and records received indexes, so **resume = re-request missing indexes** after a disconnect. On completion, verify the full-file hash and assemble/finalize. Add **deduplication** by content hash (skip storing chunks/files you already have), TTL cleanup for abandoned sessions, and per-user quotas. You built exactly this (chunked uploads + dedup + Redis/BullMQ) — anchor the whole answer in your implementation.

### Design a background job system.
API enqueues jobs (Redis/BullMQ) and returns 202 + job ID immediately; a pool of worker processes consumes with bounded concurrency. Must-cover list: retries with exponential backoff, dead-letter queue, **idempotent handlers** (dedup keys), job status endpoint or events for the client, graceful worker shutdown (finish current job, don't take new), and horizontal scaling by adding workers. Distinguish scheduled/repeatable jobs and priority queues if asked.

### Design a notification service (email/SMS/push).
Producers publish a notification *event* to a queue; the service resolves user preferences + channels, renders templates, and dispatches via provider adapters (SES/Twilio/FCM) with per-provider rate limits and retries. Key design points: idempotency key per notification (no duplicate sends on retry), provider failover, unsubscribe/preference honoring, delivery-status webhooks updating a notifications table, and batching digests. It's the same queue skeleton with fan-out and third-party failure handling on top.

### Design a URL shortener.
POST long URL → generate short code (base62 of a counter, or random 7-char with collision check) → store mapping → GET /:code does a 301/302 redirect (302 if you want analytics on every hit). Scale reads with Redis cache in front of the DB (read-heavy ~100:1), analytics via async queue so redirects stay fast. Extras if probed: custom aliases (uniqueness), expiry, and why base62-of-ID leaks creation order (use a bijective scramble or random codes).

### Design a distributed rate limiter.
Local token buckets don't work across N instances → centralize state in **Redis**. Simplest: fixed window `INCR key EXPIRE window` (boundary-burst flaw); better: sliding window log (sorted set of timestamps: ZREMRANGEBYSCORE old, ZCARD count) or token bucket state in a hash updated by a **Lua script** for atomicity. Discuss: fail-open vs fail-closed when Redis is down, per-key granularity (user/IP/API key), and returning 429 + Retry-After.

### Design a batch claims-processing pipeline (their domain).
Ingest a batch file (SFTP/API) → **validate + persist raw** first (audit trail, reprocessability) → split into per-record jobs on a queue → workers validate business rules, hit eligibility services, compute outcomes → write results transactionally with per-record status → reconciliation step compares input count vs processed vs failed, produces a report, and failed records go to a review queue. Emphasize: idempotency (reprocessing a file or record must be safe), checkpointing for restart mid-batch, immutable audit log of every state change, and PII discipline in logs. This maps directly to Wellcove's TPA/claims world — expect some variant of it.

### Monolith vs microservices — how do you answer it?
Not ideology: monolith-first for small teams (one deploy, easy refactors, in-process calls); split when teams/scaling force it — independent deploy cadence, isolating a hot or risky component, different scaling profiles. Name the costs of microservices honestly: network failure modes, distributed transactions (sagas/outbox), observability overhead, infra burden. "Modular monolith with clean boundaries → extract services when there's a concrete forcing reason" is a senior-sounding, defensible position.

### WebSockets vs SSE vs polling?
Polling: simplest, latency = interval, wasteful. Long-polling: better latency, still connection churn. SSE: one-way server→client over plain HTTP, auto-reconnect built in — perfect for feeds/notifications/progress. WebSockets: full-duplex — needed for chat, collaborative editing, games; costs: sticky sessions or a Redis pub/sub adapter to scale across instances, plus heartbeat/reconnect logic.

---

## 18. Rapid-Fire One-Liners

### fs.readFileSync vs fs.readFile vs fs.promises.readFile?
Sync blocks the event loop (only acceptable at startup, e.g., loading config); callback version is async legacy style; `fs/promises` is the modern default with await.

### path.join vs path.resolve?
`join` concatenates segments with correct separators; `resolve` builds an **absolute** path, resolving from right to left until absolute (and from `process.cwd()` if needed). `resolve(__dirname, 'x')` is the safe way to reference files relative to the module.

### Hashing vs encryption?
Hashing is one-way (integrity, passwords — with bcrypt/argon2); encryption is reversible with a key (confidentiality). "Do you encrypt passwords?" is a trap — you hash them.

### What is dotenv / process.env?
`process.env` exposes environment variables (always strings — cast booleans/numbers); dotenv loads a local `.env` file into it for development. Production injects real env vars; `.env` never goes to git.

### What is nodemon? node --watch?
Dev-only auto-restart on file change; modern Node has `node --watch` built in. Neither belongs in production (PM2/containers handle restarts there).

### res.send vs res.json vs res.end?
`json` serializes + sets `Content-Type: application/json`; `send` infers type from the argument (and calls json for objects); `end` terminates the response with no processing (raw/streams).

### What is middleware chaining's short-circuit?
Any middleware that sends a response and doesn't call `next()` ends the chain — that's how auth blocks a request. Calling next() *after* responding causes the "headers already sent" error.

### app.listen — what does it actually do?
Creates an `http.Server`, binds the port, and registers the Express app as the request handler. Equivalent: `http.createServer(app).listen(port)` — which is what you extend for HTTPS or attaching Socket.IO.

### What is keep-alive?
Reusing one TCP connection for multiple HTTP requests, skipping repeated handshakes. For outbound calls in Node, use a keep-alive Agent (or undici/fetch defaults) — a classic hidden latency win for service-to-service traffic.

### What is the os module good for?
System info: `os.cpus()` (sizing cluster workers), `os.totalmem/freemem`, `os.hostname`, `os.tmpdir`. Comes up in "how many workers would you fork?" — one per core as a starting point.

### crypto module — what do you reach for?
`randomBytes`/`randomUUID` for tokens/IDs, `createHash('sha256')` for integrity/dedup hashes, `timingSafeEqual` for comparing secrets, `pbkdf2/scrypt` if not using bcrypt/argon2 libs. Don't hand-roll crypto protocols.

### What is CORS preflight, in one line?
The browser's OPTIONS request asking permission before a non-simple cross-origin request; the server's `Access-Control-Allow-*` headers answer it, and it's cached via `Access-Control-Max-Age`.

### What is a memory-efficient way to build large JSON responses?
Don't — paginate or stream (NDJSON lines, or a streaming serializer). `JSON.stringify` on a 500 MB object blocks the loop and doubles memory.

### What's new in recent Node versions worth naming?
Built-in `fetch` and Web Streams, built-in **test runner** (`node:test`), `structuredClone`, AbortController everywhere, `node --watch`, ESM maturity/top-level await, permission model (experimental), performance work in undici. You don't need exact versions — knowing these exist signals currency.

### What is the difference between require and import at runtime?
require: synchronous function call, resolvable dynamically, returns whatever was exported at call time. import: hoisted static declaration (async loading, live bindings); `import()` is its dynamic, promise-returning form usable anywhere.

### Why might a Node process exit with code 137?
128 + 9 → killed by SIGKILL, almost always the container OOM-killer: the heap plus buffers exceeded the memory limit. Follow-up: right-size `--max-old-space-size` relative to the container limit and hunt the leak.

### What is AsyncLocalStorage?
Continuation-local storage: set a context (request ID, user) at the start of a request and read it anywhere in that async call chain without threading parameters — the mechanism behind per-request logging context and tracing.

---

## 19. Your Experience: Likely Follow-Ups & Questions to Ask

### Map your projects to expected deep-dives (rehearse these)
- **Chunked-upload/dedup cloud storage** → expect: why chunking, how resume works, how you hash/dedup, memory profile of uploads (streams/backpressure), what Redis and BullMQ each do in it. This is your best story — it touches streams, queues, hashing, and design in one artifact.
- **Redis clone in pure Node** → expect: `net` module TCP server, parsing the RESP protocol, how a single-threaded server handles many sockets (event loop!), what commands you implemented. Perfect proof you understand Node's concurrency model beneath frameworks.
- **OIDC payroll SSO** → expect: full authorization-code flow narration, id_token validation steps (signature/JWKS, iss, aud, exp, nonce), how sessions were established after, failure modes (clock skew, key rotation).
- **Playwright automation at work + Naukri automation server** → expect: flakiness war stories and fixes, waiting strategy, CI integration, page-object structure; for the phone server: Termux constraints, scheduling with cron, keeping processes alive.
- **React plugin, 90k+ users / 40+ locales** → expect: how you shipped safely at that scale, i18n pitfalls, build tooling; for a Node round, steer this toward the API/plugin architecture it talks to.
- **Production incident work (403s, WAF/IP allowlisting, partner OAuth issues)** → gold for behavioral-technical crossover: pick one incident and rehearse it as *symptom → investigation → root cause → fix → prevention* in under 3 minutes.

### "Tell me about a challenging bug" — have one ready
Use the intermittent 403 investigation: intermittent auth failures, traced through the call chain to a missing header/flag during token-refresh windows, PII-free escalation across teams, root cause + fix pattern. It demonstrates systematic debugging, reading unfamiliar code, and cross-team communication — exactly what production-support-heavy roles screen for.

### Good questions to ask the interviewer
- What does the Node stack look like — Express or NestJS, TypeScript everywhere, which Node version, monolith or services?
- How does claims/batch processing flow through the system today, and where are the pain points?
- How do you handle idempotency and auditability for financial operations?
- What does the testing culture look like — coverage expectations, E2E ownership, CI times?
- Deployment cadence and on-call structure — how are production incidents run?
- What would success look like in the first 90 days for this role?

---

*End of core reference. JD-specific section to be appended after the job description is shared.*
