import 'dotenv/config';
import { app } from './app.js';
import { connectDB } from './db/database.js';
import { error } from 'node:console';



const port = process.env.PORT || 3001;

connectDB()
.then(() => {

    const server = app.listen(port, () => {
        console.log(`Server is listening on ${port}`);
        
    })

    server.on('error', (error) => {
        console.log(`Server is getting error: ${error}`);
        
    })
 

}).catch((error) => {

    console.log(`Somthing is wrong in database: ${error}`);
    
})


