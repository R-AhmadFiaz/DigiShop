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


## BUGS DURING REFRESH TOKEN

i spend 1 hour finding mistake why my backend is failing to generate new access token with refresh token 
i accidently put verifyJWT before refresh-token route (userRouter.route('/refresh-token').post(verifyJwt, refreshAccessToken)) so when i try to run the command using postman it says Wrong signature the problem was that refresh token is called when access token is expirerd so putting verify JWT is like building a wall in front of refresh token because verifyJWT is used to check who is requesting if access token is expired then how can it allow to reach refresh-Token?


i have added current user finder with change passowrd functionality 

Added a controller that store name and description of specific category with one additional feature is slug that is used to create clear and human readable url for searching and also great for SEO 

i have created product and category model and its controller that let saved the category and then same category id is used in each product document same category products will share same category id 

i have built searchProduct cintroller that will search any product by name or brand it could take any and find the product also it will feed the category field with name of category to which this product belong to instead of raw string that is unrecognizable for human 

i have created updateProduct controller that takes multiple fields and update on daily basis rates fluctuates so i make a controller that update any filed that is provided with updated data

i have written stockQuantity adjuster that will change the stock number by using calculation rather than overwriting through updateProduct that could make the stock unaccurate if multiple cashier try to change stock simultaneously.