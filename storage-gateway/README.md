# MongoDB media storage gateway

This optional Node.js service stores messenger uploads in MongoDB GridFS. It is separate from the Cloudflare Worker because Workers cannot open MongoDB's native TCP connection.

## Multiple MongoDB databases

Set `MONGO_STORAGE_POOLS` to a JSON array. Each upload is deterministically assigned to one pool, so more than one MongoDB cluster/database can be used without putting database credentials in the Mini App.

```json
[
  { "id": "mongo-primary", "uri": "mongodb+srv://USER:PASSWORD@cluster-a.example.mongodb.net/?retryWrites=true&w=majority", "database": "messenger_media" },
  { "id": "mongo-secondary", "uri": "mongodb+srv://USER:PASSWORD@cluster-b.example.mongodb.net/?retryWrites=true&w=majority", "database": "messenger_media" }
]
```

Install and run:

```bash
npm install
export STORAGE_GATEWAY_KEY="use-a-long-random-secret"
export MONGO_STORAGE_POOLS='[{"id":"mongo-primary","uri":"mongodb+srv://...","database":"messenger_media"}]'
npm start
```

Configure the Worker secrets/vars:
- `MEDIA_GATEWAY_URL`: base URL of this service, e.g. `https://media.example.com`
- `MEDIA_GATEWAY_KEY`: same random secret as `STORAGE_GATEWAY_KEY`

The gateway must be HTTPS and reachable by the Worker. Restrict network access where possible. Never commit MongoDB URIs or API keys. Create a MongoDB database user with only the required read/write permissions for the media database.

The gateway currently distributes new files across configured pools; it does not replicate files or automatically migrate existing D1 attachments. Keep every configured pool available while files stored there are in use. Backups of MongoDB databases are separate from the D1 JSON backup.
