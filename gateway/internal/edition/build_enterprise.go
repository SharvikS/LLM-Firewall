//go:build enterprise

package edition

// BuiltEnterprise is true when the binary was compiled with `-tags enterprise`,
// meaning the commercial feature implementations are linked in. The runtime gate
// (Resolve) still requires a valid license before any feature activates.
const BuiltEnterprise = true
