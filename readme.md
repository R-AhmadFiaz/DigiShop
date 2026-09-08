# Electric Store Inventory System

This project is an inventory and management system for an electric store. The goal is to build a complete backend that can manage the store's products, stock, customers, sales, payments, invoices, and other day-to-day operations.

### Progress


Started the backend project by setting up the basic folder structure, including controllers, database, middleware, utilities, types, and constants. Connected the application to MongoDB and created a custom `ApiError` utility to handle application errors in a consistent way.

i made model for user add async handler file to wrap the controller under the safety to avoid app crash used bcrypt package to hash the password before storing to data base


successfully make the working register page backend that take username password email and role and also check whther this user is already register or not and safely create user using async handler.


I have built a login backend that will take either username or email and password to login it will check whether the user is already register and handle all the cases to avoid code crash

i added multer middleware to upload profile picture of actor in web app using cloudinary put the url in avatar field 


i build a function that generate Access and Refresh tokens by taking strings from env file and make a secret from it 

i have added verifyJwt module to populate req and provide the user when he go in authorized routes
in addition i added global type of Express that define the model of user all over the project without import and export

i have create the method that takes the refresh token whether from http req or req body comming from mobile app etc and then decode it to get the user id which then used to check whther it is same as the refresh token we have saved in database if yes then it call the function to generate the access and refresh token put in cookies again

i added logged out controller by wipe out the refresh token 