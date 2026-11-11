/**
 * Envelope encryption with no Convex dependency.
 * Its output matches the encrypted fields stored by the component.
 */
export {
  encryptSecret,
  decryptSecret,
  rewrapDEK,
  importKey,
} from "./component/crypto.js";
export { parseKeyEntries, defineKeys, type KeyEntry } from "./keys-format.js";
