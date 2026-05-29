# Repository Agent Instructions

## Rust Skill Notes

Rust code in this repository should be designed so that ownership, failure,
absence, and valid states are expressed through types and compiler checks.

### Core Principles

- Make ownership explicit: use `T` when a function consumes or stores a value,
  `&T` when it only reads, and `&mut T` when it mutates.
- Prefer borrowing over cloning. Use `Clone` only when duplicating the value is
  intentional.
- Represent absence with `Option<T>`, not sentinel values.
- Represent fallible operations with `Result<T, E>`.
- Prefer meaningful error enums over `String` errors when callers may need to
  branch on the failure reason.
- Model possible states with `enum` instead of loose strings, integers, or
  ambiguous booleans.
- Use newtypes for semantically distinct IDs or values that share the same
  primitive representation.
- Keep public APIs small. Expose only what callers need, and avoid making
  fields public by default.
- Use traits for behavior contracts and generics only where they reduce real
  duplication or clarify the API.

### Cargo Workflow

Use Cargo for normal Rust development:

```bash
cargo check
cargo fmt
cargo clippy
cargo test
```

Before considering Rust changes complete, run the relevant subset of these
commands. Prefer `cargo check` while iterating, then `cargo fmt`, `cargo clippy`,
and `cargo test` when behavior changes.

### Function Argument Design

Choose argument types by intent:

```rust
fn consume(user: User) {}
fn read(user: &User) {}
fn update(user: &mut User) {}
```

- Read-only access: `&T`
- Mutation: `&mut T`
- Consumption, ownership transfer, or long-term storage: `T`

### Option And Result

Use `Option<T>` when a value may naturally be absent:

```rust
fn find_user(id: UserId) -> Option<User> {
    // ...
}
```

Use `Result<T, E>` when an operation can fail:

```rust
fn create_user(input: Input) -> Result<User, CreateUserError> {
    // ...
}
```

Use `?` to propagate errors where it keeps the control flow direct:

```rust
fn double(s: &str) -> Result<u64, std::num::ParseIntError> {
    let n = s.parse::<u64>()?;
    Ok(n * 2)
}
```

### Error Design

Avoid unstructured errors when the caller may need to react to the failure:

```rust
#[derive(Debug)]
pub enum CreateUserError {
    EmptyName,
    TooLongName,
}
```

Errors should preserve meaning. Use `String` mainly at boundaries where no
structured handling is expected.

### State Design

Prefer enums for meaningful states, even when there are only two states:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Visibility {
    Visible,
    Hidden,
}
```

This is clearer than APIs such as `set_visible(true)` when the call site would
otherwise be ambiguous.

### Newtypes

Use newtypes to prevent mixing semantically different values:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UserId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TeamId(pub u64);
```

Prefer `find_user(id: UserId)` over `find_user(id: u64)` when the primitive type
does not communicate the domain meaning.

### Structs And Encapsulation

Use structs to group related data, and prefer private fields with public
constructors and accessors where invariants matter:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    id: UserId,
    name: String,
    status: UserStatus,
}

impl User {
    pub fn id(&self) -> UserId {
        self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}
```

### Builder Pattern

Use a builder when construction has many optional parameters, validation, or
likely future extension:

```rust
let client = ClientBuilder::new()
    .base_url("https://example.com")
    .timeout_secs(10)
    .retry(3)
    .build()?;
```

Avoid long positional constructors where arguments can be confused.

### Traits And Generics

Traits express behavior contracts:

```rust
pub trait Summary {
    fn summarize(&self) -> String;
}
```

Use trait bounds when generic code genuinely benefits from accepting multiple
types:

```rust
fn print_debug<T: std::fmt::Debug>(value: T) {
    println!("{value:?}");
}
```

### Derives

For public domain types, consider deriving the standard traits that are useful
and semantically correct:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    // ...
}
```

Common derives include `Debug`, `Clone`, `Copy`, `PartialEq`, `Eq`,
`PartialOrd`, `Ord`, `Hash`, and `Default`.

### Modules And Visibility

- Keep modules focused.
- Add `pub` only for APIs that need to cross module or crate boundaries.
- Do not expose fields just to make tests or construction easier; prefer
  constructors, accessors, or test helpers.

### Unsafe

Treat `unsafe` as a narrow boundary where humans must uphold invariants the
compiler cannot verify.

- Keep `unsafe` blocks as small as possible.
- Add a `SAFETY:` comment explaining the invariant.
- Wrap unsafe internals in safe APIs when possible.
- Document caller obligations for unsafe functions.

```rust
// SAFETY: ptr is valid, aligned, and points to initialized memory.
unsafe {
    *ptr
}
```

### One-Sentence Rule

In Rust, ambiguous ownership, absence, failure, and state should be managed by
types and the compiler instead of runtime convention.
