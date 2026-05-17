const app=require('./app');
const PORT=process.env.PORT||3001;
//Start the server and listen on the specified port.
app.listen(PORT,()=> { 
    console.log(`server is running on port ${PORT}`);

});

