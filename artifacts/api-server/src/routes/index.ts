import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import storeSalesRouter from "./store-sales";
import reportRouter from "./report";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stockRouter);
router.use(storeSalesRouter);
router.use(reportRouter);
router.use("/auth", authRouter);

export default router;
