require('dotenv').config()
// import dotenv from 'ścieżka'

const express = require('express')
const app = express()
const port = 3000
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const pool = require('./database');

app.use(express.json())


app.get('/', (req, res) => {
  res.send("test")
})

//Rejestracja
app.post('/register', async (req, res) => {
    try {
        const { email, password, firstname, surname, city, country, phone } = req.body

        if(!email || !password){
            return res.status(400).send()
        }

        const existingUser = await pool.query('SELECT email FROM users_data.logins WHERE email = $1',
            [email]
        )

        if(existingUser.rows.length > 0){
            return res.status(409).send()
        }

        const salt = await bcrypt.genSalt()
        const hashedPassword = await bcrypt.hash(password, salt)
        const createdAt = new Date()
                
        await pool.query('INSERT INTO users_data.logins (email, password, created_at, sysRole) VALUES ($1, $2, $3, 1)',
            [email, hashedPassword, createdAt]
        )
        await pool.query('INSERT INTO users_data.users (email, first_name, surname, phone, city, country) VALUES ($1, $2, $3, $4, $5, $6)',
            [email, firstname, surname, phone, city, country]
        )

        res.status(201).send()

    } 
    catch (err){
        console.log(err)
        res.status(500).send()
    }

})

//Logowanie
app.post('/login', async (req, res) =>{
    try{
        const { email, password } = req.body

        if(!email || !password){
            return res.status(400).send()
        }

        const existingUser = await pool.query('SELECT email FROM users_data.logins WHERE email = $1',
            [email]
        )
        
        if(existingUser.rows.length == 0){
            return res.status(401).send()
        }

        const passwordCheck = await bcrypt.compare(password, user.password)
        if(!passwordCheck){
            return res.status(401).send()
        }

        const token = jwt.sign(
            { email: user.email },
            process.env.ACCESS_SECRET_TOKEN,
            { expiresIn: "2h" }
        )
    } 
    catch (err){
        console.log(err)
        res.status(500).send()
    }
})

app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})