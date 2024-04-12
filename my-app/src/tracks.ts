import { zValidator } from "@hono/zod-validator";
import { client, finalizeTrackUpload, getSong, getSongAudio, searchSongs, uploadSongDetails, uploadTrackAudio, uploadTrackCoverImage } from "./supabase";
import { Context, Hono, MiddlewareHandler } from "hono";
import { SongSearch, SongTempUpload, SongUpload } from "./types";

const tracksRouter = new Hono()


export const isAuthenticated: MiddlewareHandler = async (c: Context, next) => {
    if(!c.req.header("Authorization") || !c.req.header("Authorization")?.startsWith("Bearer ")) {
        c.status(400)
        throw new Error("No Access Token Found!")
    }
    const {data, error} = await client.auth.getUser(c.req.header("Authorization")?.split(" ")[1])
    if(error) throw error
    /*@ts-ignore*/
    c.user = data.user
    await next()
}
tracksRouter.use(isAuthenticated)


tracksRouter.post("/search", zValidator("json", SongSearch), async (c) => {
    let {tags, searchQuery} = c.req.valid("json")
    if(!searchQuery) return {}
    if(!tags || !Array.isArray(tags)) tags = []
    const results = await searchSongs(searchQuery, tags)
    if(!results.success) {
        c.status(400)
    }
    return c.json(results)
})

tracksRouter.get("/:trackId/audio", async (c) => {
    const trackId = c.req.param("trackId")
    const audio = await getSongAudio(trackId)
    if(!audio.success) {
        c.status(400)
    }
    return c.json(audio)
})


tracksRouter.get("/:trackId", async (c) => {
    const trackId = c.req.param("trackId")
    if(!trackId) {
        c.status(404)
        return c.json({
            message: "Track ID not found!",
            error: 404
        })
    }
    const track = await getSong(trackId)
    return c.json(track)
})

tracksRouter.post("/upload/audio", async (c) => {
    const body = await c.req.parseBody()
    const f = body["audio"]
    if(!(f instanceof File) || !f) {c.status(400); return c.json({success: false, error: {message: "File not found!", code: 400}})}
    const r = await uploadTrackAudio(body.id, f)
    if(!r.success) {
            c.status(400)
            
    }
    return c.json(r)
})

tracksRouter.post("/upload/cover", async (c) => {
    const body = await c.req.parseBody()
    const f = body["cover"]
    if(!f || !(f instanceof File)) { c.status(400); return c.json({success: false, error: {message: "File not found!", code: 400}})}
    const r = await uploadTrackCoverImage(body.id, f)
    if(!r.success) {
            c.status(400)
            
    }
    return c.json(r)
})

tracksRouter.post("/upload/finalize", async (c) => {
    const body = await c.req.json()
    const trackUploadResponse = await finalizeTrackUpload(c.req.user, body.id)
    if(!trackUploadResponse.success) {
        c.status(400)
    }
    return c.json(trackUploadResponse)
})

tracksRouter.post("/upload/details", zValidator("json", SongTempUpload), async (c) => {
    const body = c.req.valid("json")
    const result = await uploadSongDetails(c.user, body)
    if(!result.success) {
        c.status(400)
    }
    return c.json(result)
})

export default tracksRouter





