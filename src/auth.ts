import { Hono } from "hono"
import { createUser, getAccessTokenFromRefresh, signInToUser, validateOTP } from "./supabase"
import { zValidator } from "@hono/zod-validator"
import { UserCreate, UserRefreshToken, UserSignIn } from "./types"

const authRouter = new Hono()

authRouter.post("/signup", zValidator("json", UserCreate), async (c) => {
    const response = await createUser(c.req.valid("json"))
    if(!response.success) {
        c.status(response.error?.status ?? 400)
    }
    return c.json(response)
})

authRouter.post("/login", zValidator("json", UserSignIn), async (c) => {
    const response = await signInToUser(c.req.valid("json"))
    if(response.error) {
        c.status(400)
    }
    return c.json(response)
})

authRouter.post("/users/refresh", zValidator("json", UserRefreshToken), async (c) => {
    const response = await getAccessTokenFromRefresh(c.req.valid("json"))
    if(response.error) {
        c.status(400)
    }
    return c.json(response)
})

authRouter.post("/otp/verify", zValidator("json", UserActivation), async (c) => {
    const response = await validateOTP(c.req.valid("json"))
    if(!response.success) {
        c.status(response.error?.status)
    }
    return c.json(response)
})

export default authRouter
