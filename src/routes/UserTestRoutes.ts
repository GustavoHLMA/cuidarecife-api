import { Router } from "express";
import { UserTestController } from '../controllers';

const userTestRouter = Router();

userTestRouter.route("/").post(UserTestController.create);
userTestRouter.route("/:userTestId").get(UserTestController.read);
userTestRouter.route("/").get(UserTestController.readAll);
userTestRouter.route("/:userTestId").put(UserTestController.update);
userTestRouter.route("/:userTestId").delete(UserTestController.delete);

export default userTestRouter;

