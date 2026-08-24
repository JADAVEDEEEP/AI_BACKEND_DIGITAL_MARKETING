const express = require('express');

require('dotenv').config();
const reportRouter = require('./routes/reportrouter');
const app = express();

const PORT = process.env.PORT || 3000;      

app.use(express.json());
app.get('/',(req,res)=>{
    res.json({message:"API is Live"})
})


app.use('/api',reportRouter)


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})