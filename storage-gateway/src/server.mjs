import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MongoClient, GridFSBucket, ObjectId } from "mongodb";

const PORT = Number(process.env.PORT || 8788);
const API_KEY = process.env.STORAGE_GATEWAY_KEY || "";
const MAX_BYTES = Number(process.env.MAX_FILE_BYTES || 100 * 1024 * 1024);
const pools = JSON.parse(process.env.MONGO_STORAGE_POOLS || "[]");
if (!API_KEY || !Array.isArray(pools) || !pools.length) throw new Error("Set STORAGE_GATEWAY_KEY and MONGO_STORAGE_POOLS");
const clients = new Map();
async function bucketFor(poolId) {
  const pool = pools.find(p => p.id === poolId);
  if (!pool?.uri || !pool?.database) throw new Error("Unknown storage pool");
  if (!clients.has(poolId)) {
    const client = new MongoClient(pool.uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 });
    clients.set(poolId, client.connect().then(() => new GridFSBucket(client.db(pool.database), { bucketName: "messenger_files" })));
  }
  return clients.get(poolId);
}
function choosePool(key) {
  let hash = 2166136261;
  for (const ch of key) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return pools[(hash >>> 0) % pools.length].id;
}
function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
const server = createServer(async (req, res) => {
  try {
    if (req.headers.authorization !== "Bearer " + API_KEY) return send(res, 401, { error: "UNAUTHORIZED" });
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, pools: pools.map(p => p.id) });
    if (req.method === "PUT" && url.pathname === "/v1/files") {
      const key = url.searchParams.get("key") || "";
      const filename = (url.searchParams.get("filename") || "file").slice(0, 120);
      if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return send(res, 400, { error: "INVALID_KEY" });
      const poolId = choosePool(key);
      const bucket = await bucketFor(poolId);
      const upload = bucket.openUploadStream(filename, { metadata: { appKey: key, mime: req.headers["content-type"] || "application/octet-stream" } });
      let size = 0;
      req.on("data", chunk => { size += chunk.length; if (size > MAX_BYTES) req.destroy(new Error("FILE_SIZE_LIMIT")); });
      await pipeline(req, upload);
      return send(res, 201, { storageKey: poolId + ":" + upload.id.toString(), size });
    }
    if (req.method === "GET" && url.pathname === "/v1/files") {
      const storageKey = url.searchParams.get("key") || "";
      const split = storageKey.indexOf(":");
      if (split < 1) return send(res, 400, { error: "INVALID_KEY" });
      const poolId = storageKey.slice(0, split), id = storageKey.slice(split + 1);
      if (!/^[a-f0-9]{24}$/i.test(id)) return send(res, 400, { error: "INVALID_KEY" });
      const bucket = await bucketFor(poolId);
      const files = await bucket.find({ _id: new ObjectId(id) }).toArray();
      if (!files.length) return send(res, 404, { error: "NOT_FOUND" });
      res.writeHead(200, { "content-type": files[0].metadata?.mime || "application/octet-stream", "content-length": String(files[0].length), "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" });
      await pipeline(bucket.openDownloadStream(new ObjectId(id)), res);
      return;
    }
    return send(res, 404, { error: "NOT_FOUND" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: error?.message === "FILE_SIZE_LIMIT" ? "FILE_SIZE_LIMIT" : "STORAGE_ERROR" });
    else res.destroy();
  }
});
server.listen(PORT, () => console.log("MongoDB media gateway listening on " + PORT));
