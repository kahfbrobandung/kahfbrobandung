import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import storeSalesRouter from "./store-sales";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stockRouter);
router.use(storeSalesRouter);

export default router;
