import { PostgrestError, PostgrestResponse, User, createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import {SongTempUploadType, SongType, SongUploadType, UserCreateType, UserOTPVerifyType, UserRefreshTokenType, UserSignInType } from "./types.js";
import * as mm from 'music-metadata';
config()
import crypto from "crypto"

export const client = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_KEY ?? "", {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
})



const createSearchString = (searchString: string) => {
    return searchString
      .trim()
      .split(/[\s,\t,\n]+/) // split and remove more than 1 space
      .join(' | ');
  };
export async function searchSongs(searchQuery: string, tags?: string[]) {
    if(!searchQuery) return {error: {message: "Search query wasn't found!", status: 400}}
    const query = client.from("tracks").select("id,name,tags,uploaded_at,length,cover_path").textSearch("fts", `${createSearchString(searchQuery)}`).filter("exposed", "eq", true)
    if(tags) {
        query.contains("tags", tags)
    }
    const {data, error} = await query
    if(error) {
        return {success: false, error: {message: error.message, status: +error.code}}
    }
    return {success: true, songs: data}

}

export async function getAccessTokenFromRefresh(body: UserRefreshTokenType) {
    const {data, error} = await client.auth.refreshSession({refresh_token: body.refreshToken})
    if(error) {
        return {success: false, error}
    }
    const getProfileResponse = await client.from("profiles").select("username").eq("id", data.user?.id).single()
    return {success: true, session: {...data.session, username: getProfileResponse.data?.username}}
}

function createFTS(details: SongTempUploadType, username: string) {
    return `${username} ${details.name}`
}

export async function uploadTrackAudio(id: string, f: File) {
    if(!id) return {success: false, error: {message: "Id wasn't found!"}}
    console.log(id)
    const buf = await f.arrayBuffer()
    const mmData = await mm.parseBuffer(new Uint8Array(buf))
    const {data, error} = await client.storage.from("track_audios").upload(`${crypto.randomUUID()}.${f.name.substring(f.name.lastIndexOf(".")+1)}`, buf)
    if(error) {
        return {success: false, error}
    }
    const {error: err} = await client.from("tracks").update({length: mmData.format.duration, audio_path: data.path}).eq("id", id)
    if(err) {
        return {success: false, error: err}
    }
    return {success: true}
}



export async function finalizeTrackUpload(user: User, trackId: string) {
    const trackExposedResponse = await client.from("tracks").update({exposed: true}).eq("id", trackId)
    if(trackExposedResponse.error) {
        return {success: false, error: trackExposedResponse.error}
    }
    return {success: true, id: trackId}
}

export async function uploadTrackCoverImage(id: string, f: File) {
    if(!id) return {success: false, error: {message: "Id wasn't found!"}}
    const {data, error} = await client.storage.from("track_cover_images").upload(`${crypto.randomUUID()}.${f.name.split(".")[1]}`, await f.arrayBuffer())
    if(error) {
        return {success: false, error}
    }
    await client.from("tracks").update({cover_path: data.path}).eq("id", id)
    return {success: true}
}

export async function uploadSongDetails(user: User, details: SongTempUploadType) {
    const getProfileResponse = await client.from("profiles").select("username").eq("id", user.id).single()
    const {data,error} = await client.from("tracks").insert({...details, fts: createFTS(details,getProfileResponse.data?.username), uploader_id: user.id, exposed: false}).select("id").single()
    if(error) {
        console.log(error)
        return {success: false, error}
    }
    return {success: true, id: data.id}
}

export async function getSongAudio(songId: string) {
    const {data, error} = await client.from("tracks").select("audio_path").eq("id", songId).eq("exposed", true).limit(1).single()
    if(error) {
        return {success: false, error}
    }
    const {data: data2, error: error2} = await client.storage.from("track_audios").createSignedUrl(data.audio_path, 3600)
    if(error2) {
        return {success: false, error2}
    }
    return {success: true, audioUrl: data2.signedUrl}
}


export async function createUser(details: UserCreateType) {
    if(details.password !== details.confirmPassword) return {success: false, error: {message: "Unverified password!", status: 400}}
    if(details.password.length < 8) return {success: false, error: {message: "Password isn't long enough", status: 422}}

    const checkUserResponse = await client.from("profiles").select("*").eq("email", details.email).limit(1)

    if(checkUserResponse.error) {
        return {success: false, error: checkUserResponse.error}
    }
    if(checkUserResponse.count && checkUserResponse.count > 0) {
        return {success: false, error: {message: "The user already exists in the system, please login!", status: 400}}
    }

    const checkUsernameResponse = await client.from("profiles").select("*").eq("username", details.username).limit(1)

    if(checkUsernameResponse.error) {
        return {success: false, error: checkUsernameResponse.error}
    }

    if(checkUsernameResponse.count && checkUsernameResponse.count > 0) {
        return {success: false, error: {message: "The username is taken already, try a different username!", status: 400}}

    }

    const createdUser = await client.auth.signUp({
        email: details.email,
        password: details.password,
    })
    const emailIsTaken = createdUser.data.user?.identities?.length === 0
    if(createdUser.error){
        //console.log(error)
        if(!createdUser.error.message.includes("duplicate key value")) {
            return {error: createdUser.error, success: false}
        }
    }
    if(emailIsTaken) {
        return {success: false}
    }
    const createProfileResponse = await client.from("profiles").insert({
        id: createdUser.data.user?.id,
        email: details.email,
        username: details.username
    })
    if(createProfileResponse.error) {
        await client.auth.admin.deleteUser(createdUser.data.user?.id)
        return {success: false}
    }
    
    return {success: true}
}

export async function validateOTP(details: UserOTPVerifyType) {
    const {data, error} = await client.auth.verifyOtp({
        email: details.email,
        token: details.otp, 
        type: "email"       
    })
    if(error) {
        return {success: false, error}
    }
    const getProfileResponse = await client.from("profiles").select("username").eq("id", data.user?.id).single()
    return {success: true, session: {...data.session, username: getProfileResponse.data?.username}}
}

export async function isAuthed(token: string) {
    const {error} = await client.auth.getUser(token)
    if(error) {
        return false
    }
    return true
}

export async function signInToUser(details: UserSignInType) {
    
    const {data,error} = await client.auth.signInWithPassword({
        email: details.email,
        password: details.password
    })
    if(error) {
        return {success: false, error}
    }
    const getProfileResponse = await client.from("profiles").select("username").eq("id", data.user.id).single()
    return {success: true, session: {...data.session,username: getProfileResponse.data?.username}}
}


export async function getSong(id: string): Promise<{success: boolean, track: SongType} | {error: PostgrestError, success: boolean}> {
    const query =  client.from("tracks").select("id,name,tags,uploaded_at,cover_path,uploader_id,length").eq("id", id).eq("exposed", true).limit(1).single<SongType>()
    const {data, error} = await query
    if(error) {
        console.log(error)
        return {success: false, error}
    }
    const getUploaderProfileResponse = await client.from("profiles").select("username").eq("id", data.uploader_id).single()
    return {success: true, track: {...data, username: getUploaderProfileResponse.data?.username}}
}

