class apiError extends Error{
    statusCode: number

    constructor(statusCode: number, messege: string = 'Something is Wrong'){
        super(messege)
        this.statusCode = statusCode;
    }

}

export {apiError}