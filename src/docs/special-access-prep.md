# Purpose
This file is used as source of data related to the new feature, have special way how the access to some pages and endpoints is going to be emulated. This file will be used for creating efficient execution plan that will later when executed change the code base.

# Feature
At the moment we have access roles, and if you have host role you are able to access some pages and access some api resources. What I want to create is a special access mechanism that will mimic the role in some resources when some parameters are meet. Let me explain this. I want host to be able to give this access rights in some small window. Specifically the page inspectionGuide/:apartmentId/:reservationId, where initial reservation proofs are collected. So access to this page and access to the endpoints used on these pages would have to work for the host, or for the special access that was given by the host.
I was thinking that we can have a table, record where we can add all this info, like apartment, reservation ids, and we can have a uuid something like accessId, which will be passed in the param on the page and on the request. This will be the signal for the api to check if this accessId exists, what is it connected to and does this api resource can be used with this access. So basically this will be a temporary work around for the host access for certain api resources in certain time limit.
This will give an option to the host to create this accessId for the things related to the inspectionGuide or tomorrow to something else, and just share the link with the person that needs this access. After time limit, the access wouldn't work.

# Gotchas
1. This is not a host access mimic. No. This is mimic for some group of api resources on a limited amount of time.
2. This access method needs to work with the current ones, so now we have this rolesGuard functionality, it needs to work with the role and with the accessId.
3. This access method needs to be very efficient and not create performance issues.
4. The specific accesses, and right now I only have 2 in mind, the access to the page and resources needed to create the initial proofs before the reservation starts, and damage evidence photo collection that is needed after the reservation checkout as a part of the damage claim flow. Both are connected with collecting of the photos and nothing else. So, I want to document all the instances of this access, and have them in the code, maybe as enums or something like that.
5. If you see any other gotchas, or potential issues, you need to point me to it.

# For the exec plan
Scan the code and do figure out what is the recommended and safe way to do this. I do not want to corupt the code I have right now, nor the access rights, but at the same time I want to have this temporary, limited, host controlled, resource focused, access ability.