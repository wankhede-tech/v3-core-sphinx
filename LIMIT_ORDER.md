# Limit Orders Uniswap V3 Test Task

This project is fork of Uniswap V3 which inlcudes additional feature of executing Limit Orders. As mentioned in the task, currently, it is possible to provide liquidity to Uniswap V3 at a single tick, but users must manually remove liquidity from the position once filled, otherwise the position may unfill if price moves back across the tick.

We tried to solve this problem using three functions:

1. createLimitOrder(address recipient, int24 tickLower, uint128 amount):  This function generates a limit order for a designated recipient, with a price range targeting tickLower to tickLower + 1. Users have the option to specify the liquidity amount they wish to provide.

2. cancelLimitOrder(address recipient, int24 tickLower): Users can employ this function to terminate their limit orders. If the order has not been completely executed, it returns the remaining unfilled portion (along with the swapped amount in cases of partial fills) to the user. Cancellation is not allowed for orders that have already been filled.

3. collectLimitOrder(address recipient, int24 tickLower): After a limit order has been completely filled, users can retrieve the swapped amount by utilizing this function. Collection is prohibited if the order is either not filled or only partially filled.

## Scope of Improvements

There is a lot of room for improments in the code which could not be covered due to the time crunch. A few of them include:

- In the current Implementation most of the code lies in pool contract only, create a saperate contract for managing limit orders or connect the logic to a library.
- Work on gas cost optimization
- Some tests are failing, update them according to new implementation of pool contract.
- Limit orders are managed under address `limitOrderManager` which is address 0, change it to a contract to reduce code size in pool.