import { Decimal } from 'decimal.js'
import { BigNumber, BigNumberish, ContractTransaction, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { MockTimeUniswapV3Pool } from '../typechain/MockTimeUniswapV3Pool'
import { TestERC20 } from '../typechain/TestERC20'
import { SqrtPriceMathTest } from '../typechain/SqrtPriceMathTest'
import { TickMathTest } from '../typechain/TickMathTest'

import { expect } from './shared/expect'
import { poolFixture } from './shared/fixtures'
import { formatPrice, formatTokenAmount } from './shared/format'
import {
  createPoolFunctions,
  encodePriceSqrt,
  expandTo18Decimals,
  FeeAmount,
  getMaxTick,
  getMinTick,
  TICK_SPACINGS,
} from './shared/utilities'

Decimal.config({ toExpNeg: -500, toExpPos: 500 })

const createFixtureLoader = waffle.createFixtureLoader
const { constants } = ethers

interface BaseSwapTestCase {
  zeroForOne: boolean
  sqrtPriceLimit?: BigNumber
}
interface SwapExact0For1TestCase extends BaseSwapTestCase {
  zeroForOne: true
  exactOut: false
  amount0: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface SwapExact1For0TestCase extends BaseSwapTestCase {
  zeroForOne: false
  exactOut: false
  amount1: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface Swap0ForExact1TestCase extends BaseSwapTestCase {
  zeroForOne: true
  exactOut: true
  amount1: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface Swap1ForExact0TestCase extends BaseSwapTestCase {
  zeroForOne: false
  exactOut: true
  amount0: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface SwapToHigherPrice extends BaseSwapTestCase {
  zeroForOne: false
  sqrtPriceLimit: BigNumber
}
interface SwapToLowerPrice extends BaseSwapTestCase {
  zeroForOne: true
  sqrtPriceLimit: BigNumber
}
type SwapTestCase =
  | SwapExact0For1TestCase
  | Swap0ForExact1TestCase
  | SwapExact1For0TestCase
  | Swap1ForExact0TestCase
  | SwapToHigherPrice
  | SwapToLowerPrice


type PoolFunctions = ReturnType<typeof createPoolFunctions>

const SWAP_RECIPIENT_ADDRESS = constants.AddressZero.slice(0, -1) + '1'

async function executeSwap(
  pool: MockTimeUniswapV3Pool,
  testCase: SwapTestCase,
  poolFunctions: PoolFunctions
): Promise<ContractTransaction> {
  let swap: ContractTransaction
  if ('exactOut' in testCase) {
    if (testCase.exactOut) {
      if (testCase.zeroForOne) {
        swap = await poolFunctions.swap0ForExact1(testCase.amount1, SWAP_RECIPIENT_ADDRESS, testCase.sqrtPriceLimit)
      } else {
        swap = await poolFunctions.swap1ForExact0(testCase.amount0, SWAP_RECIPIENT_ADDRESS, testCase.sqrtPriceLimit)
      }
    } else {
      if (testCase.zeroForOne) {
        swap = await poolFunctions.swapExact0For1(testCase.amount0, SWAP_RECIPIENT_ADDRESS, testCase.sqrtPriceLimit)
      } else {
        swap = await poolFunctions.swapExact1For0(testCase.amount1, SWAP_RECIPIENT_ADDRESS, testCase.sqrtPriceLimit)
      }
    }
  } else {
    if (testCase.zeroForOne) {
      swap = await poolFunctions.swapToLowerPrice(testCase.sqrtPriceLimit, SWAP_RECIPIENT_ADDRESS)
    } else {
      swap = await poolFunctions.swapToHigherPrice(testCase.sqrtPriceLimit, SWAP_RECIPIENT_ADDRESS)
    }
  }
  return swap
}

const DEFAULT_POOL_SWAP_TEST: SwapTestCase = 
  {
    zeroForOne: false,
    exactOut: false,
    amount1: expandTo18Decimals(3),
  };


interface Position {
  tickLower: number
  tickUpper: number
  liquidity: BigNumberish
}

interface PoolTestCase {
  description: string
  feeAmount: number
  tickSpacing: number
  startingPrice: BigNumber
  positions: Position[]
  swapTests?: SwapTestCase[]
}

const poolCase: PoolTestCase = 
  {
    description: 'low fee, 1:1 price, 2e18 max range liquidity',
    feeAmount: FeeAmount.LOW,
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    startingPrice: encodePriceSqrt(1, 1),
    positions: [
      {
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.LOW]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.LOW]),
        liquidity: expandTo18Decimals(2),
      },
    ],
  };

describe('Limit Order tests', () => {
  let wallet: Wallet, other: Wallet
  let tickMath: TickMathTest
  const liquidityAmount = 100000000;

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let sqrtPriceMath: SqrtPriceMathTest
  before('create fixture loader', async () => {
    ;[wallet, other] = await (ethers as any).getSigners()
    const sqrtPriceMathTestFactory = await ethers.getContractFactory('SqrtPriceMathTest')
    sqrtPriceMath = (await sqrtPriceMathTestFactory.deploy()) as SqrtPriceMathTest
    loadFixture = createFixtureLoader([wallet])
    const factory = await ethers.getContractFactory('TickMathTest')
    tickMath = (await factory.deploy()) as TickMathTest
  })

      const poolCaseFixture = async () => {
        const { createPool, token0, token1, swapTargetCallee: swapTarget } = await poolFixture(
          [wallet],
          waffle.provider
        )
        const pool = await createPool(poolCase.feeAmount, poolCase.tickSpacing)
        const poolFunctions = createPoolFunctions({ swapTarget, token0, token1, pool })
        await pool.initialize(poolCase.startingPrice)
        // mint all positions
        for (const position of poolCase.positions) {
          await poolFunctions.mint(wallet.address, position.tickLower, position.tickUpper, position.liquidity)
        }

        const [poolBalance0, poolBalance1] = await Promise.all([
          token0.balanceOf(pool.address),
          token1.balanceOf(pool.address),
        ])

        return { token0, token1, pool, poolFunctions, poolBalance0, poolBalance1, swapTarget }
      }

      let token0: TestERC20
      let token1: TestERC20

      let pool: MockTimeUniswapV3Pool
      let poolFunctions: PoolFunctions

      

      beforeEach('load fixture', async () => {
        ;({ token0, token1, pool, poolFunctions} = await loadFixture(
          poolCaseFixture
        ))
      })
      it("create limit order", async () => {
        const slot0 = await pool.slot0()
        const [
          poolBalance0After,
          poolBalance1After,
          slot0After,
          liquidityAfter,
          feeGrowthGlobal0X128,
          feeGrowthGlobal1X128,
        ] = await Promise.all([
          token0.balanceOf(pool.address),
          token1.balanceOf(pool.address),
          pool.slot0(),
          pool.liquidity(),
          pool.feeGrowthGlobal0X128(),
          pool.feeGrowthGlobal1X128(),
        ])

        const bl0 = await token0.balanceOf(wallet.address);
        await token0.approve(pool.address, bl0);
        const bl1 = await token1.balanceOf(wallet.address);
        await token1.approve(pool.address, bl1);
        const tx =  pool.connect(wallet).createLimitOrder(wallet.address, slot0.tick, 100000000);
        await expect(tx).to.emit(pool, "Mint");
        
      })
      it("cancel limit order", async () => {
        const slot0 = await pool.slot0()
        const [
          poolBalance0After,
          poolBalance1After,
          slot0After,
          liquidityAfter,
          feeGrowthGlobal0X128,
          feeGrowthGlobal1X128,
        ] = await Promise.all([
          token0.balanceOf(pool.address),
          token1.balanceOf(pool.address),
          pool.slot0(),
          pool.liquidity(),
          pool.feeGrowthGlobal0X128(),
          pool.feeGrowthGlobal1X128(),
        ])

        const bl0 = await token0.balanceOf(wallet.address);
        await token0.approve(pool.address, bl0);
        const bl1 = await token1.balanceOf(wallet.address);
        await token1.approve(pool.address, bl1);
        await pool.createLimitOrder(wallet.address, slot0.tick, 100000000);
        const sqrtRatioLower = await tickMath.getSqrtRatioAtTick(slot0.tick);
        const sqrtRatioUpper = await tickMath.getSqrtRatioAtTick(slot0.tick + (await pool.tickSpacing()));
        const amount0 = await sqrtPriceMath.getAmount0Delta(sqrtRatioLower, sqrtRatioUpper, 100000000, false);
        const balanceBefore = await token0.balanceOf(wallet.address);
        await pool.connect(wallet).cancelLimitOrder(wallet.address, slot0.tick);
        const amount = await token0.balanceOf(wallet.address);
        expect(await token0.balanceOf(wallet.address)).to.eq(balanceBefore.add(amount0));
      })
      it("should not be able to create limit order if have already placed order on that tick", async () => {
        const slot0 = await pool.slot0()
        const [
          poolBalance0After,
          poolBalance1After,
          slot0After,
          liquidityAfter,
          feeGrowthGlobal0X128,
          feeGrowthGlobal1X128,
        ] = await Promise.all([
          token0.balanceOf(pool.address),
          token1.balanceOf(pool.address),
          pool.slot0(),
          pool.liquidity(),
          pool.feeGrowthGlobal0X128(),
          pool.feeGrowthGlobal1X128(),
        ])

        const bl0 = await token0.balanceOf(wallet.address);
        await token0.approve(pool.address, bl0);
        await pool.createLimitOrder(wallet.address, slot0.tick, 100000000);
        const tx = pool.createLimitOrder(wallet.address, slot0.tick, 100000000);
        await expect(tx).to.be.revertedWith('Previous limit order on this tick must be filled or canceled before placing new limit order');
      })
      it("should not be able to cancel limit order if order is filled", async () => {
        const slot0 = await pool.slot0()
        const [
          poolBalance0After,
          poolBalance1After,
          slot0After,
          liquidityAfter,
          feeGrowthGlobal0X128,
          feeGrowthGlobal1X128,
        ] = await Promise.all([
          token0.balanceOf(pool.address),
          token1.balanceOf(pool.address),
          pool.slot0(),
          pool.liquidity(),
          pool.feeGrowthGlobal0X128(),
          pool.feeGrowthGlobal1X128(),
        ])

        const bl0 = await token0.balanceOf(wallet.address);
        await token0.approve(pool.address, bl0);
        await pool.createLimitOrder(wallet.address, slot0.tick, 100000000);
        await executeSwap(pool, DEFAULT_POOL_SWAP_TEST, poolFunctions);
        const tx = pool.connect(wallet).cancelLimitOrder(wallet.address, slot0.tick);
        await expect(tx).to.be.revertedWith('Filled order cannot be canceled');
      })
      it("collect limit order", async () => {
        const slot0 = await pool.slot0()
        const [
          poolBalance0After,
          poolBalance1After,
          slot0After,
          liquidityAfter,
          feeGrowthGlobal0X128,
          feeGrowthGlobal1X128,
        ] = await Promise.all([
          token0.balanceOf(pool.address),
          token1.balanceOf(pool.address),
          pool.slot0(),
          pool.liquidity(),
          pool.feeGrowthGlobal0X128(),
          pool.feeGrowthGlobal1X128(),
        ])

        const bl0 = await token0.balanceOf(wallet.address);
        await token0.approve(pool.address, bl0);
        await pool.createLimitOrder(wallet.address, slot0.tick, 100000000);
        await executeSwap(pool, DEFAULT_POOL_SWAP_TEST, poolFunctions);
        const balanceBefore = await token1.balanceOf(wallet.address);
        const tx = pool.connect(wallet).collectLimitOrder(wallet.address, slot0.tick);
        const sqrtRatioLower = await tickMath.getSqrtRatioAtTick(slot0.tick);
        const sqrtRatioUpper = await tickMath.getSqrtRatioAtTick(slot0.tick + (await pool.tickSpacing()));
        const amount1 = await sqrtPriceMath.getAmount1Delta(sqrtRatioLower, sqrtRatioUpper, 100000000, false);
        expect((await token1.balanceOf(wallet.address)).sub(balanceBefore.add(amount1)).isNegative()).to.eq(false); // value + accumulated fees
      })
      it("should not be able to collect limit order if tick is not crossed", async () => {
        const slot0 = await pool.slot0()
        const [
          poolBalance0After,
          poolBalance1After,
          slot0After,
          liquidityAfter,
          feeGrowthGlobal0X128,
          feeGrowthGlobal1X128,
        ] = await Promise.all([
          token0.balanceOf(pool.address),
          token1.balanceOf(pool.address),
          pool.slot0(),
          pool.liquidity(),
          pool.feeGrowthGlobal0X128(),
          pool.feeGrowthGlobal1X128(),
        ])

        const bl0 = await token0.balanceOf(wallet.address);
        await token0.approve(pool.address, bl0);
        await pool.createLimitOrder(wallet.address, slot0.tick, 100000000);
        const tx = pool.connect(wallet).collectLimitOrder(wallet.address, slot0.tick);

        await expect(tx).to.be.revertedWith('Order not ready to collect');
      })
})
