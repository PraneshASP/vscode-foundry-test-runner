<img align="right" width="150" height="150" top="100" src="./assets/logo.png">

# VSCode Foundry Test Runner • [![license](https://img.shields.io/badge/MIT-brown.svg?label=license)](https://github.com/PraneshASP/vscode-foundry-test-adapter/blob/main/LICENSE)

An extension for VSCode editor to easily explore and run tests using the [foundry framework](https://github.com/gakonst/foundry). This is an adapter that is intended to work with VSCode's [native Test Explorer API](https://code.visualstudio.com/api/extension-guides/testing).

> Note: This adapter is in a very early stage. Beta testers are welcome!

---

### Features at a glance:

- Displays a Test Explorer in the Test view of VS Code's sidebar with all detected tests and suites along with their state.
- Adds CodeLenses to your test files for running specific tests.
- Display test logs in the Test Results panel.
- Allows for verbosity configuration.
- Exclude test files and test functions.

## Blocked

- [ ] Run tests in debug mode - this requires DAP, the best chance of this existing is [rethnet](https://medium.com/nomic-foundation-blog/slang-rethnet-2ad465fd7880).
- [ ] Coverage - Foundry has a separate command for this (`forge coverage --report lcov`), which can be viewed using the [Coverage Gutters](https://marketplace.visualstudio.com/items?itemName=ryanluker.vscode-coverage-gutters) extension.

---

## Requirements

The following will need to be installed in order to use this template. Please follow the links and instructions.

- [Foundry / Foundryup](https://github.com/gakonst/foundry)
  - This will install `forge`, `cast`, `chisel` and `anvil`
  - You can test you've installed them right by running `forge --version` and get an output like: `forge 0.2.0 (f016135 2022-07-04T00:15:02.930499Z)`
  - To get the latest of each, just run `foundryup`

## Usage

The usage of this extension is straightforward.

- Install this adapter extension.
- Click on the Test Icon displayed on the Activity bar.
- Run your tests using the Run icon in the Test Explorer or the CodeLenses in your test file

### 1.) Run a single test from the explorer

<img src="./assets/single_test.gif" />

---

### 2.) Run a test suite (all the tests in a contract) from the explorer

<img src="./assets/run_suite.gif" />

---

### 3.) Run a test using the Codelens (inline option in the editor)

<img src="./assets/codelens.gif" />

---

### 4.) Configure verbosity, exclude test contracts and functions

<img src="./assets/settings.png" />

---

<!-- CONTRIBUTING -->

## Contributing

Contributions are welcomed. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Acknowledgement

- [Mocha Test Adapter](https://github.com/hbenl/vscode-mocha-test-adapter)
