import z from "zod"
export const SongUpload = z.object({
  name: z.string(),
  tags: z.array(z.string()),
  audio_path: z.string(),
  image_path: z.string(),
  uploader_id: z.optional(z.string()),
  length: z.number(),
})


export const SongSearch = z.object({
    searchQuery: z.string(),
    tags: z.optional(z.array(z.string()))
})

export const Song = z.object({
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
})


export const SongTempUpload = z.object({
  name: z.string(),
tags: z.array(z.string())
})

export const UserCreate = z.object({
    email: z.string().email("This isn't a valid email"),
    password: z.string(),
    confirmPassword: z.string(),
    username: z.string()
})

export const UserSignIn = z.object({
    email: z.string().email("This isn't a valid email"),
    password: z.string()
})

export const UserOTPVerify = z.object({
  email: z.string().email("This isn't a valid email"),
  otp: z.string().min(6).max(6)
})

export const UserRefreshToken = z.object({
  refreshToken: z.string()
})

export type SongUploadType = z.infer<typeof SongUpload>
export type SongSearchType = z.infer<typeof SongSearch>
export type SongType = z.infer<typeof Song>
export type UserCreateType = z.infer<typeof UserCreate>
export type UserSignInType = z.infer<typeof UserSignIn>
export type UserOTPVerifyType = z.infer<typeof UserOTPVerify>
export type UserRefreshTokenType = z.infer<typeof UserRefreshToken>
export type SongTempUploadType = z.infer<typeof SongTempUpload>