//go:build !enterprise

package edition

// BuiltEnterprise is false in the default (open-core, MIT) build: the commercial
// feature implementations are not compiled in, only community no-op stubs are.
const BuiltEnterprise = false
