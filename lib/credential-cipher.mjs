import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
const key=secret=>{if(!secret)throw new Error('Worker credential encryption is not configured.');return createHash('sha256').update(secret).digest()};
export function encryptCredential(value,secret){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);
  const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptCredential(value,secret){
  try{
    const [version,iv,tag,payload]=String(value).split('.');if(version!=='v1')throw new Error();
    const decipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(iv,'base64url'));decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(payload,'base64url')),decipher.final()]).toString('utf8');
  }catch{throw new Error('Source authorization could not be decrypted. Reconnect the source and retry.')}
}
