class AppError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status

    def payload(self):
        return {"error": {"code": self.code, "message": self.message}}
