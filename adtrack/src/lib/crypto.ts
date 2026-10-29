import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

// 이름·연락처 암호화 (AES-256-GCM). 키는 LEAD_ENCRYPTION_KEY (32바이트, base64).
// 키를 잃으면 저장된 이름·연락처를 읽을 수 없으니 따로 안전하게 보관해야 한다.

let keys: { enc: Buffer; mac: Buffer } | null = null;

function getKeys() {
  if (keys) return keys;
  const raw = process.env.LEAD_ENCRYPTION_KEY;
  const master = raw ? Buffer.from(raw, 'base64') : null;
  if (!master || master.length !== 32) {
    throw new Error('LEAD_ENCRYPTION_KEY 가 없거나 32바이트가 아니에요 (openssl rand -base64 32)');
  }
  keys = {
    enc: Buffer.from(hkdfSync('sha256', master, '', 'adtrack lead enc v1', 32)),
    mac: Buffer.from(hkdfSync('sha256', master, '', 'adtrack lead mac v1', 32)),
  };
  return keys;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKeys().enc, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(value: string): string {
  const [version, iv, tag, ct] = value.split(':');
  if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('알 수 없는 암호문 형식');
  const decipher = createDecipheriv('aes-256-gcm', getKeys().enc, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

// 같은 연락처 찾기용. 숫자만 남긴 번호를 넣는다.
export function phoneHash(digits: string): string {
  return createHmac('sha256', getKeys().mac).update(digits).digest('base64url');
}

// 이름 검색용. 공백을 빼고 비교하므로 '김 민수' 와 '김민수' 는 같다.
export function nameHash(name: string): string {
  return createHmac('sha256', getKeys().mac).update(`name:${name.replace(/\s+/g, '').toLowerCase()}`).digest('base64url');
}

export function ipHash(ip: string): string {
  return createHmac('sha256', getKeys().mac).update(`ip:${ip}`).digest('base64url').slice(0, 22);
}
