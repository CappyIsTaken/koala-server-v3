'use strict';

var nodeServer = require('@hono/node-server');
var hono = require('hono');
var zodValidator = require('@hono/zod-validator');
var supabaseJs = require('@supabase/supabase-js');
var dotenv = require('dotenv');
var mm = require('music-metadata');
var crypto = require('crypto');
var z = require('zod');
var cors = require('hono/cors');

function _interopNamespaceDefault(e) {
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var mm__namespace = /*#__PURE__*/_interopNamespaceDefault(mm);

dotenv.config();
const client = supabaseJs.createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_KEY ?? "", {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
const createSearchString = (searchString) => {
  return searchString.trim().split(/[\s,\t,\n]+/).join(" | ");
};
async function searchSongs(searchQuery, tags) {
  if (!searchQuery)
    return { error: { message: "Search query wasn't found!", status: 400 } };
  const query = client.from("tracks").select("id,name,tags,uploaded_at,length,cover_path").textSearch("fts", `${createSearchString(searchQuery)}`).filter("exposed", "eq", true);
  if (tags) {
    query.contains("tags", tags);
  }
  const { data, error } = await query;
  if (error) {
    return { success: false, error: { message: error.message, status: +error.code } };
  }
  return { success: true, songs: data };
}
async function getAccessTokenFromRefresh(body) {
  const { data, error } = await client.auth.refreshSession({ refresh_token: body.refreshToken });
  if (error) {
    return { success: false, error };
  }
  const getProfileResponse = await client.from("profiles").select("username").eq("id", data.user?.id).single();
  return { success: true, session: { ...data.session, username: getProfileResponse.data?.username } };
}
function createFTS(details, username) {
  return `${username} ${details.name}`;
}
async function uploadTrackAudio(id, f) {
  if (!id)
    return { success: false, error: { message: "Id wasn't found!" } };
  console.log(id);
  const buf = await f.arrayBuffer();
  const mmData = await mm__namespace.parseBuffer(new Uint8Array(buf));
  const { data, error } = await client.storage.from("track_audios").upload(`${crypto.randomUUID()}.${f.name.substring(f.name.lastIndexOf(".") + 1)}`, buf);
  if (error) {
    return { success: false, error };
  }
  const { error: err } = await client.from("tracks").update({ length: mmData.format.duration, audio_path: data.path }).eq("id", id);
  if (err) {
    return { success: false, error: err };
  }
  return { success: true };
}
async function finalizeTrackUpload(user, trackId) {
  const trackExposedResponse = await client.from("tracks").update({ exposed: true }).eq("id", trackId);
  if (trackExposedResponse.error) {
    return { success: false, error: trackExposedResponse.error };
  }
  return { success: true, id: trackId };
}
async function uploadTrackCoverImage(id, f) {
  if (!id)
    return { success: false, error: { message: "Id wasn't found!" } };
  const { data, error } = await client.storage.from("track_cover_images").upload(`${crypto.randomUUID()}.${f.name.split(".")[1]}`, await f.arrayBuffer());
  if (error) {
    return { success: false, error };
  }
  await client.from("tracks").update({ cover_path: data.path }).eq("id", id);
  return { success: true };
}
async function uploadSongDetails(user, details) {
  const getProfileResponse = await client.from("profiles").select("username").eq("id", user.id).single();
  const { data, error } = await client.from("tracks").insert({ ...details, fts: createFTS(details, getProfileResponse.data?.username), uploader_id: user.id, exposed: false }).select("id").single();
  if (error) {
    console.log(error);
    return { success: false, error };
  }
  return { success: true, id: data.id };
}
async function getSongAudio(songId) {
  const { data, error } = await client.from("tracks").select("audio_path").eq("id", songId).eq("exposed", true).limit(1).single();
  if (error) {
    return { success: false, error };
  }
  const { data: data2, error: error2 } = await client.storage.from("track_audios").createSignedUrl(data.audio_path, 3600);
  if (error2) {
    return { success: false, error2 };
  }
  return { success: true, audioUrl: data2.signedUrl };
}
async function createUser(details) {
  if (details.password !== details.confirmPassword)
    return { success: false, error: { message: "Unverified password!", status: 400 } };
  if (details.password.length < 8)
    return { success: false, error: { message: "Password isn't long enough", status: 422 } };
  const checkUserResponse = await client.from("profiles").select("*").eq("email", details.email).limit(1);
  if (checkUserResponse.error) {
    return { success: false, error: checkUserResponse.error };
  }
  if (checkUserResponse.count && checkUserResponse.count > 0) {
    return { success: false, error: { message: "The user already exists in the system, please login!", status: 400 } };
  }
  const checkUsernameResponse = await client.from("profiles").select("*").eq("username", details.username).limit(1);
  if (checkUsernameResponse.error) {
    return { success: false, error: checkUsernameResponse.error };
  }
  if (checkUsernameResponse.count && checkUsernameResponse.count > 0) {
    return { success: false, error: { message: "The username is taken already, try a different username!", status: 400 } };
  }
  const createdUser = await client.auth.signUp({
    email: details.email,
    password: details.password
  });
  const emailIsTaken = createdUser.data.user?.identities?.length === 0;
  if (createdUser.error) {
    if (!createdUser.error.message.includes("duplicate key value")) {
      return { error: createdUser.error, success: false };
    }
  }
  if (emailIsTaken) {
    return { success: false };
  }
  const createProfileResponse = await client.from("profiles").insert({
    id: createdUser.data.user?.id,
    email: details.email,
    username: details.username
  });
  if (createProfileResponse.error) {
    await client.auth.admin.deleteUser(createdUser.data.user?.id);
    return { success: false };
  }
  return { success: true };
}
async function validateOTP(details) {
  const { data, error } = await client.auth.verifyOtp({
    email: details.email,
    token: details.otp,
    type: "email"
  });
  if (error) {
    return { success: false, error };
  }
  const getProfileResponse = await client.from("profiles").select("username").eq("id", data.user?.id).single();
  return { success: true, session: { ...data.session, username: getProfileResponse.data?.username } };
}
async function signInToUser(details) {
  const { data, error } = await client.auth.signInWithPassword({
    email: details.email,
    password: details.password
  });
  if (error) {
    return { success: false, error };
  }
  const getProfileResponse = await client.from("profiles").select("username").eq("id", data.user.id).single();
  return { success: true, session: { ...data.session, username: getProfileResponse.data?.username } };
}
async function getSong(id) {
  const query = client.from("tracks").select("id,name,tags,uploaded_at,cover_path,uploader_id,length").eq("id", id).eq("exposed", true).limit(1).single();
  const { data, error } = await query;
  if (error) {
    console.log(error);
    return { success: false, error };
  }
  const getUploaderProfileResponse = await client.from("profiles").select("username").eq("id", data.uploader_id).single();
  return { success: true, track: { ...data, username: getUploaderProfileResponse.data?.username } };
}

z.object({
  name: z.string(),
  tags: z.array(z.string()),
  audio_path: z.string(),
  image_path: z.string(),
  uploader_id: z.optional(z.string()),
  length: z.number()
});
const SongSearch = z.object({
  searchQuery: z.string(),
  tags: z.optional(z.array(z.string()))
});
z.object({
  name: z.string(),
  tags: z.array(z.string()),
  id: z.optional(z.string()),
  uploaded_at: z.optional(z.date()),
  uploader_id: z.optional(z.string()),
  length: z.number(),
  cover_path: z.string(),
  audio_path: z.string(),
  fts: z.string(),
  username: z.optional(z.string())
});
const SongTempUpload = z.object({
  name: z.string(),
  tags: z.array(z.string())
});
const UserCreate = z.object({
  email: z.string().email("This isn't a valid email"),
  password: z.string(),
  confirmPassword: z.string(),
  username: z.string()
});
const UserSignIn = z.object({
  email: z.string().email("This isn't a valid email"),
  password: z.string()
});
const UserOTPVerify = z.object({
  email: z.string().email("This isn't a valid email"),
  otp: z.string().min(6).max(6)
});
const UserRefreshToken = z.object({
  refreshToken: z.string()
});

const tracksRouter = new hono.Hono();
const isAuthenticated = async (c, next) => {
  if (!c.req.header("Authorization") || !c.req.header("Authorization")?.startsWith("Bearer ")) {
    c.status(400);
    throw new Error("No Access Token Found!");
  }
  const { data, error } = await client.auth.getUser(c.req.header("Authorization")?.split(" ")[1]);
  if (error)
    throw error;
  c.user = data.user;
  await next();
};
tracksRouter.use(isAuthenticated);
tracksRouter.post("/search", zodValidator.zValidator("json", SongSearch), async (c) => {
  let { tags, searchQuery } = c.req.valid("json");
  if (!searchQuery)
    return {};
  if (!tags || !Array.isArray(tags))
    tags = [];
  const results = await searchSongs(searchQuery, tags);
  if (!results.success) {
    c.status(400);
  }
  return c.json(results);
});
tracksRouter.get("/:trackId/audio", async (c) => {
  const trackId = c.req.param("trackId");
  const audio = await getSongAudio(trackId);
  if (!audio.success) {
    c.status(400);
  }
  return c.json(audio);
});
tracksRouter.get("/:trackId", async (c) => {
  const trackId = c.req.param("trackId");
  if (!trackId) {
    c.status(404);
    return c.json({
      message: "Track ID not found!",
      error: 404
    });
  }
  const track = await getSong(trackId);
  return c.json(track);
});
tracksRouter.post("/upload/audio", async (c) => {
  const body = await c.req.parseBody();
  const f = body["audio"];
  if (!(f instanceof File) || !f) {
    c.status(400);
    return c.json({ success: false, error: { message: "File not found!", code: 400 } });
  }
  const r = await uploadTrackAudio(body.id, f);
  if (!r.success) {
    c.status(400);
  }
  return c.json(r);
});
tracksRouter.post("/upload/cover", async (c) => {
  const body = await c.req.parseBody();
  const f = body["cover"];
  if (!f || !(f instanceof File)) {
    c.status(400);
    return c.json({ success: false, error: { message: "File not found!", code: 400 } });
  }
  const r = await uploadTrackCoverImage(body.id, f);
  if (!r.success) {
    c.status(400);
  }
  return c.json(r);
});
tracksRouter.post("/upload/finalize", async (c) => {
  const body = await c.req.json();
  const trackUploadResponse = await finalizeTrackUpload(c.req.user, body.id);
  if (!trackUploadResponse.success) {
    c.status(400);
  }
  return c.json(trackUploadResponse);
});
tracksRouter.post("/upload/details", zodValidator.zValidator("json", SongTempUpload), async (c) => {
  const body = c.req.valid("json");
  const result = await uploadSongDetails(c.user, body);
  if (!result.success) {
    c.status(400);
  }
  return c.json(result);
});

const authRouter = new hono.Hono();
authRouter.post("/signup", zodValidator.zValidator("json", UserCreate), async (c) => {
  const response = await createUser(c.req.valid("json"));
  if (!response.success) {
    c.status(response.error?.status ?? 400);
  }
  return c.json(response);
});
authRouter.post("/login", zodValidator.zValidator("json", UserSignIn), async (c) => {
  const response = await signInToUser(c.req.valid("json"));
  if (response.error) {
    c.status(400);
  }
  return c.json(response);
});
authRouter.post("/users/refresh", zodValidator.zValidator("json", UserRefreshToken), async (c) => {
  const response = await getAccessTokenFromRefresh(c.req.valid("json"));
  if (response.error) {
    c.status(400);
  }
  return c.json(response);
});
authRouter.post("/otp/verify", zodValidator.zValidator("json", UserOTPVerify), async (c) => {
  const response = await validateOTP(c.req.valid("json"));
  if (!response.success) {
    c.status(response.error?.status);
  }
  return c.json(response);
});

const app = new hono.Hono();
app.use(cors.cors());
app.route("/tracks", tracksRouter);
app.route("/users", authRouter);
app.get("/", (c) => {
  return c.text("Hello Hono!");
});
const port = 3e3;
console.log(`Server is running on port ${port}`);
nodeServer.serve({
  fetch: app.fetch,
  port
});
