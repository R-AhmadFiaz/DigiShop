class apiResponse{
    statusCode: number
    data: {}
    messege: string

    constructor(statusCode: number, data: {}, messege: string){

        this.statusCode = statusCode
        this.data = data
        this.messege = messege




    }
}

export {apiResponse}