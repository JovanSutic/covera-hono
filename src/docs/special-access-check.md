# Purpose
This file will describe the behavior of the special access through access params. This file should be consulted before building the execution plan related to the current blockers caught on the FE side.

# Structure
The structure, that will help the feature refinement and possible build of the additional endpoints, will be in the user stories looking from the FE side of the endpoints use.

# Use cases
1. Look into covera\src\lib\router\routes\public.ts you can track path: "incident/:incidentId/proofs", path: "inspection-guide/:apartmentId/:reservationId" these paths should be transfered to the host file and they should be accessed like this. IF the user that is trying to access them is a host then the regular auth is enough, this doesn't concern you. But if the user requesting access to the page is not signed as host, then app will check if there is access param, if there is an access param (uuid), then this access param needs to be checked for validity, the BE resource for checking this is C:\Users\Jovan\Desktop\bets\covera-hono\src\db\schema\special-access.ts special access table. So, there should be a record with this uuid, this record has to match all ids, incident, apartment, reservation, also it needs to match the scope. If all those are matched, then return should be 200, and this person can access this page.

2. Look at bullet 1, the same machanism needs to be used for all the get endpoints related to these 2 pages, and the final post related to these 2 pages. Basically, the user with the special access, can get all the resources as same as a host, and he is able to post the photos from both pages. Now, this means that these endpoints should be accessable with this mechanism. And there needs to be an addition to the access rules, I think we are using specialAccessGuard for this, so it needs to be aligned with this.

3. So from the FE application, this app is exposing the endpoint needed to check this special access, that will be used on the page load. And it also provides the space for sending this uuid and some flag on the endpoints used on these pages, so that FE app can indicate to this application that this is not the host, but this is a special access user and access to these endpoints needs to be going through the special access mechanism.

4. The file covera-hono\src\docs\backend-blockers-prep.md hold the list of the endpoints and paths that you need to unlock for this special access. But you need to hold this use cases in mind when you are creating the solution for the execution plan.