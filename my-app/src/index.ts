import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import tracksRouter from './tracks'
import authRouter from './auth'
import { cors } from 'hono/cors'

const app = new Hono()

app.use(cors())

app.route("/tracks", tracksRouter)
app.route("/users", authRouter)


app.get('/', (c) => {
  return c.text('Hello Hono!')
})

const port = 3000
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port
})
