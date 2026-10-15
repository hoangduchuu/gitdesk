import { gitEnv } from './repo'

// Code under test runs git with process.env; isolate it from the developer's own git config.
Object.assign(process.env, gitEnv)
