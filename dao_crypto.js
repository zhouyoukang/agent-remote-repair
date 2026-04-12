// ╔══════════════════════════════════════════════════════════════╗
// ║  道 · 端到端密码学 (dao_crypto.js) v1.0                     ║
// ║                                                              ║
// ║  道可道，非常道 — 真正的安全从底层涌现，非外部附加            ║
// ║                                                              ║
// ║  Ed25519  — 非对称签名 (公钥验证, 私钥签名, 不可伪造)        ║
// ║  X25519   — 密钥交换 (前向安全, 每连接独立, 妥协不溯及)      ║
// ║  AES-256-GCM — 认证加密 (机密性 + 完整性 + 认证)            ║
// ║  HKDF     — 密钥派生 (从共享秘密到会话密钥)                  ║
// ║                                                              ║
// ║  每个设备一对 Ed25519 密钥 = 身份 (不可伪造)                  ║
// ║  每个连接一对 X25519 密钥 = 前向安全 (妥协不溯及)            ║
// ║  每条消息一个 AES-GCM 密文 = 端到端加密 (中间无法窥视)      ║
// ║                                                              ║
// ║  零外部依赖 · 纯 Node.js crypto · ≥18.0                     ║
// ╚══════════════════════════════════════════════════════════════╝

"use strict";

var crypto = require("crypto");

// ═══════════════════════════════════════════════════════════
// ASN.1 DER 前缀 — 将原始32字节密钥包装为Node.js KeyObject
// Ed25519: OID 1.3.101.112    X25519: OID 1.3.101.110
// ═══════════════════════════════════════════════════════════

var ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex"); // 12 bytes
var ED25519_PKCS8 = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
); // 16 bytes
var X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");
var X25519_PKCS8 = Buffer.from(
  "302e020100300506032b656e04220420",
  "hex",
);

// ═══════════════════════════════════════════════════════════
//  无极 · DaoKeys — 密钥生成与编解码
//  万物之源: 从密码学随机数中生成一切密钥材料
// ═══════════════════════════════════════════════════════════

var DaoKeys = {
  // Ed25519 密钥对 → { publicKey: Buffer(32), privateKey: Buffer(32) }
  ed25519Generate: function () {
    var kp = crypto.generateKeyPairSync("ed25519");
    return {
      publicKey: kp.publicKey
        .export({ type: "spki", format: "der" })
        .subarray(12),
      privateKey: kp.privateKey
        .export({ type: "pkcs8", format: "der" })
        .subarray(16),
    };
  },

  // X25519 密钥对 → { publicKey: Buffer(32), privateKey: Buffer(32) }
  x25519Generate: function () {
    var kp = crypto.generateKeyPairSync("x25519");
    return {
      publicKey: kp.publicKey
        .export({ type: "spki", format: "der" })
        .subarray(12),
      privateKey: kp.privateKey
        .export({ type: "pkcs8", format: "der" })
        .subarray(16),
    };
  },

  // 原始字节 → Node.js KeyObject
  ed25519PubObj: function (raw) {
    return crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI, raw]),
      format: "der",
      type: "spki",
    });
  },
  ed25519PrivObj: function (raw) {
    return crypto.createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8, raw]),
      format: "der",
      type: "pkcs8",
    });
  },
  x25519PubObj: function (raw) {
    return crypto.createPublicKey({
      key: Buffer.concat([X25519_SPKI, raw]),
      format: "der",
      type: "spki",
    });
  },
  x25519PrivObj: function (raw) {
    return crypto.createPrivateKey({
      key: Buffer.concat([X25519_PKCS8, raw]),
      format: "der",
      type: "pkcs8",
    });
  },

  // 指纹: SHA256(公钥) 前16个hex字符 (64 bits — 唯一标识)
  fingerprint: function (pubRaw) {
    return crypto
      .createHash("sha256")
      .update(pubRaw)
      .digest("hex")
      .slice(0, 16);
  },
};

// ═══════════════════════════════════════════════════════════
//  太极 · DaoSigner — Ed25519 数字签名
//  阴阳分离: 私钥签名, 公钥验证. 不可互换, 不可伪造.
//  与HMAC的根本区别: 验证者无需知道私钥
// ═══════════════════════════════════════════════════════════

function DaoSigner(privRaw, pubRaw) {
  this._priv = DaoKeys.ed25519PrivObj(privRaw);
  this._pub = DaoKeys.ed25519PubObj(pubRaw);
  this._pubRaw = Buffer.from(pubRaw);
}

DaoSigner.prototype.sign = function (data) {
  return crypto.sign(
    null,
    Buffer.isBuffer(data) ? data : Buffer.from(data),
    this._priv,
  );
};

DaoSigner.prototype.verify = function (data, sig) {
  return crypto.verify(
    null,
    Buffer.isBuffer(data) ? data : Buffer.from(data),
    this._pub,
    Buffer.isBuffer(sig) ? sig : Buffer.from(sig),
  );
};

DaoSigner.prototype.publicKeyHex = function () {
  return this._pubRaw.toString("hex");
};

DaoSigner.prototype.publicKeyRaw = function () {
  return this._pubRaw;
};

// 静态: 用裸公钥验证签名 (无需私钥 — 这就是非对称密码学的意义)
DaoSigner.verifyWithPub = function (data, sig, pubRaw) {
  try {
    var pub = DaoKeys.ed25519PubObj(
      Buffer.isBuffer(pubRaw) ? pubRaw : Buffer.from(pubRaw, "hex"),
    );
    return crypto.verify(
      null,
      Buffer.isBuffer(data) ? data : Buffer.from(data),
      pub,
      Buffer.isBuffer(sig) ? sig : Buffer.from(sig),
    );
  } catch (e) {
    return false;
  }
};

// ═══════════════════════════════════════════════════════════
//  两仪 · DaoCipher — AES-256-GCM 认证加密
//  机密性 + 完整性 + 认证 = 三位一体
//  输出格式: IV(12) + AuthTag(16) + Ciphertext(N)
// ═══════════════════════════════════════════════════════════

var DaoCipher = {
  encrypt: function (key, plaintext, aad) {
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    if (aad)
      cipher.setAAD(Buffer.isBuffer(aad) ? aad : Buffer.from(aad));
    var pt = Buffer.isBuffer(plaintext)
      ? plaintext
      : Buffer.from(plaintext);
    var ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    var tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]); // 12 + 16 + N
  },

  decrypt: function (key, sealed, aad) {
    if (!sealed || sealed.length < 28)
      throw new Error("ciphertext too short");
    var iv = sealed.subarray(0, 12);
    var tag = sealed.subarray(12, 28);
    var ct = sealed.subarray(28);
    var decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    if (aad)
      decipher.setAAD(Buffer.isBuffer(aad) ? aad : Buffer.from(aad));
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  },
};

// ═══════════════════════════════════════════════════════════
//  四象 · DaoExchange — X25519 ECDH 密钥交换
//  前向安全: 临时密钥用完即弃, 主密钥泄露不溯及已有会话
// ═══════════════════════════════════════════════════════════

function DaoExchange() {
  var kp = DaoKeys.x25519Generate();
  this._pub = kp.publicKey;
  this._priv = kp.privateKey;
}

DaoExchange.prototype.publicKeyHex = function () {
  return this._pub.toString("hex");
};

DaoExchange.prototype.publicKeyRaw = function () {
  return Buffer.from(this._pub);
};

// 用对方公钥 + 上下文信息派生会话密钥 (32 bytes AES-256)
DaoExchange.prototype.deriveKey = function (peerPubRaw, salt, info) {
  var myPriv = DaoKeys.x25519PrivObj(this._priv);
  var peerPub = DaoKeys.x25519PubObj(
    Buffer.isBuffer(peerPubRaw)
      ? peerPubRaw
      : Buffer.from(peerPubRaw, "hex"),
  );
  var shared = crypto.diffieHellman({
    privateKey: myPriv,
    publicKey: peerPub,
  });
  var derived = crypto.hkdfSync(
    "sha256",
    shared,
    salt || "dao-e2e-v1",
    info || "session-key",
    32,
  );
  return Buffer.from(derived);
};

// 用完即弃: 覆写私钥内存
DaoExchange.prototype.destroy = function () {
  if (this._priv) {
    crypto.randomBytes(32).copy(this._priv);
    this._priv = null;
  }
};

// ═══════════════════════════════════════════════════════════
//  八卦 · DaoChannel — 端到端加密通道
//  每条消息独立加密, 随机IV, 认证加密
// ═══════════════════════════════════════════════════════════

function DaoChannel(sessionKey) {
  this._key = Buffer.from(sessionKey);
}

DaoChannel.prototype.seal = function (plaintext) {
  var pt = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(plaintext);
  return DaoCipher.encrypt(this._key, pt);
};

DaoChannel.prototype.open = function (sealed) {
  var buf = Buffer.isBuffer(sealed)
    ? sealed
    : Buffer.from(sealed, "base64");
  return DaoCipher.decrypt(this._key, buf);
};

// JSON 便捷方法: seal → base64url string
DaoChannel.prototype.sealJSON = function (obj) {
  return this.seal(Buffer.from(JSON.stringify(obj))).toString("base64url");
};

// JSON 便捷方法: base64url string → parsed object
DaoChannel.prototype.openJSON = function (b64) {
  return JSON.parse(
    this.open(Buffer.from(b64, "base64url")).toString("utf-8"),
  );
};

// 清除密钥材料
DaoChannel.prototype.destroy = function () {
  if (this._key) {
    crypto.randomBytes(32).copy(this._key);
    this._key = null;
  }
};

// ═══════════════════════════════════════════════════════════
//  万物 · DaoToken — Ed25519 签名令牌
//  公钥可验 · 私钥独签 · 不可伪造 · 不可篡改
//
//  格式: dao2.<base64url(payload)>.<base64url(ed25519_signature)>
//  与旧HMAC令牌的根本区别: 验证只需公钥, 创建需要私钥
// ═══════════════════════════════════════════════════════════

var TOKEN_PREFIX = "dao2.";

var DaoToken = {
  PREFIX: TOKEN_PREFIX,

  // 创建令牌 (需要DaoSigner — 即需要私钥)
  create: function (signer, ttl, meta) {
    var now = Math.floor(Date.now() / 1000);
    var payload = Object.assign(
      {
        fp: DaoKeys.fingerprint(signer._pubRaw),
        iat: now,
        exp: now + (ttl || 3600),
        nonce: crypto.randomBytes(8).toString("hex"),
      },
      meta || {},
    );
    var payloadStr = JSON.stringify(payload);
    var payloadB64 = Buffer.from(payloadStr).toString("base64url");
    var sig = signer.sign(Buffer.from(payloadStr));
    var sigB64 = sig.toString("base64url");
    return TOKEN_PREFIX + payloadB64 + "." + sigB64;
  },

  // 验证令牌 (只需公钥 — 这是非对称密码学的核心优势)
  // 返回 payload 对象或 null
  verify: function (token, pubRaw) {
    try {
      if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
      var rest = token.slice(TOKEN_PREFIX.length);
      var dotIdx = rest.indexOf(".");
      if (dotIdx < 0) return null;
      var payloadB64 = rest.slice(0, dotIdx);
      var sigB64 = rest.slice(dotIdx + 1);
      var payloadBuf = Buffer.from(payloadB64, "base64url");
      var sigBuf = Buffer.from(sigB64, "base64url");
      if (sigBuf.length !== 64) return null; // Ed25519 sig is always 64 bytes
      if (!DaoSigner.verifyWithPub(payloadBuf, sigBuf, pubRaw))
        return null;
      var data = JSON.parse(payloadBuf.toString("utf-8"));
      if ((data.exp || 0) < Date.now() / 1000) return null;
      return data;
    } catch (e) {
      return null;
    }
  },

  // 验证旧式 HMAC 令牌 (向后兼容 — 迁移期使用)
  verifyLegacy: function (token, seed) {
    try {
      if (!token || token.startsWith(TOKEN_PREFIX)) return null;
      var parts = token.split(".", 2);
      if (parts.length !== 2) return null;
      var payloadBuf = Buffer.from(parts[0], "hex");
      var expectedSig = crypto
        .createHmac("sha256", seed)
        .update(payloadBuf)
        .digest("hex")
        .slice(0, 32);
      if (parts[1].length !== 32) return null;
      if (
        !crypto.timingSafeEqual(
          Buffer.from(parts[1]),
          Buffer.from(expectedSig),
        )
      )
        return null;
      var data = JSON.parse(payloadBuf.toString("utf-8"));
      if ((data.exp || 0) < Date.now() / 1000) return null;
      return data;
    } catch (e) {
      return null;
    }
  },
};

// ═══════════════════════════════════════════════════════════
//  守护 · DaoRateLimit — 滑动窗口速率限制
//  柔弱胜刚强: 温和拒绝, 不声不响, 攻击者自知无用
// ═══════════════════════════════════════════════════════════

function DaoRateLimit(maxAttempts, windowMs) {
  this._max = maxAttempts || 20;
  this._window = windowMs || 60000;
  this._map = new Map();
  // 自动清理: 每5分钟
  var self = this;
  this._timer = setInterval(function () {
    self._cleanup();
  }, 300000);
  if (this._timer.unref) this._timer.unref();
}

// 返回 true = 允许, false = 限流
DaoRateLimit.prototype.check = function (key) {
  var now = Date.now();
  var window = this._window;
  var list = this._map.get(key) || [];
  var valid = [];
  for (var i = 0; i < list.length; i++) {
    if (now - list[i] < window) valid.push(list[i]);
  }
  if (valid.length >= this._max) {
    this._map.set(key, valid);
    return false;
  }
  valid.push(now);
  this._map.set(key, valid);
  return true;
};

DaoRateLimit.prototype._cleanup = function () {
  var now = Date.now();
  var window = this._window;
  var dead = [];
  this._map.forEach(function (list, key) {
    var alive = [];
    for (var i = 0; i < list.length; i++) {
      if (now - list[i] < window) alive.push(list[i]);
    }
    if (alive.length === 0) dead.push(key);
  });
  for (var i = 0; i < dead.length; i++) {
    this._map.delete(dead[i]);
  }
};

// ═══════════════════════════════════════════════════════════
//  道 · 导出
// ═══════════════════════════════════════════════════════════

module.exports = {
  DaoKeys: DaoKeys,
  DaoSigner: DaoSigner,
  DaoCipher: DaoCipher,
  DaoExchange: DaoExchange,
  DaoChannel: DaoChannel,
  DaoToken: DaoToken,
  DaoRateLimit: DaoRateLimit,
};
