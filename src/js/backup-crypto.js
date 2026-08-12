/* 可跨设备恢复的口令加密个人备份：PBKDF2-SHA256 + AES-256-GCM。 */

const ENCRYPTED_FORMAT = 'hamlogbook-encrypted-personal-info';
const ITERATIONS = 210000;

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function isEncryptedPersonalInfoBackup(value) {
  return value?.format === ENCRYPTED_FORMAT;
}

export async function encryptPersonalInfoBackup(value, passphrase) {
  if (String(passphrase || '').length < 8) throw new Error('备份密码至少需要 8 个字符');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(String(passphrase), salt, ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    format: ENCRYPTED_FORMAT,
    schema_version: 1,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function decryptPersonalInfoBackup(envelope, passphrase) {
  if (!isEncryptedPersonalInfoBackup(envelope) || Number(envelope.schema_version) !== 1) {
    throw new Error('不是受支持的加密个人信息备份');
  }
  const iterations = Number(envelope.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) {
    throw new Error('加密备份参数无效');
  }
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const data = base64ToBytes(envelope.data);
    if (salt.length !== 16 || iv.length !== 12 || !data.length) throw new Error('invalid envelope');
    const key = await deriveKey(String(passphrase || ''), salt, iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    throw new Error('备份密码错误，或文件已经损坏');
  }
}
