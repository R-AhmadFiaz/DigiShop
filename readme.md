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

i have added the feature controller that will check the stock that goes below the red line already set and need more stock it will give the count and product whole info who is decline 


it takes me whole day to build create order controller because there were few challenges to cope with we used mongoose operator to calculate the stock and manage the data if the request failed midway to save data from getting corrupt and will return the previous stock and data back safely 


i have added two controller one to cancel the order safely without correcpting the data and second one is to change the status from pending to deliver 

# End of backend core functions

today i have completed my backend system that have all core functions enough to run the store inventory safely and all code is production ready tyoe safe using type script learn a lot through out my project 


## continuing

by doing research about market i come to realize i need to upgrade the backend to stand out in market fro tht i will do more addition in this backend 

i have make the controller that will make quotation whioch will not touch stock it just fetch product the quantity and make the total cost of it 

as following the sequence after quotation i decide to make the controller that will take the quotation change it into invoice so the sequence to of sale will be first quotation so we dont blindly browse the stock and database that buyer dont even volunteer to buy so it is safe check it will first give customer estimation after that if he desire to buy we can change it to invoice

Secondly i have added order base discound feature that owner will set and it will calculate subtotal minus the discount it can be fixed and percentage and then provide total bill

Now come the most usefull controller every shop and warehouse need is to check the history of his stock and sell purchase to manage the buissness for that i created view stock log controller that will take query and retrive the data related with pages number of item found and page limit 


I have made a restriction that only owner of store can create account for cashier for that i have created a createStaff controller that only owner request can accept and enter in it and create the account