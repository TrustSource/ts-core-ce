#How to install Swagger:

* Checkout (clone) Swagger-UI from: https://github.com/swagger-api/swagger-ui.git into a temp directory
    
        git clone https://github.com/swagger-api/swagger-ui.git
        
* build according the documentation on github:

        copy content of swagger-ui-5.3.2\dist to public\swagger-latest

        
### Modifications to code:
* keep changes from `index.css`
* keep <script src='./lib/iframeResizer.contentWindow.min.js' type='text/javascript'></script> inside `index.html`
- update url: "/api-v2/openapi.yaml" in `swagger-initializer.js`


### How to install iframe-resizer:
Due to incompatibilities between meteor and Swagger-UI packages, the hole Swagger-UI is integrated into the application
via an iFrame-element. To solve the dynamic scaling problem of the included iFrame,
the JS-project **iframe-resizer** https://github.com/davidjbradshaw/iframe-resizer is used.

* copy the helper file for included iFrames, **iframeResizer.contentWindow.min.js**, into the swagger/lib directory and
  modify **swagger/index.html** accordingly to load this file:

        <!-- added to lib directory to dynamically resize the Swagger-UI-iFrame -->
        <script src='lib/iframeResizer.contentWindow.min.js' type='text/javascript'></script>
* copy the library file **iframeResizer.min.js** into the meteor **client/vendor/iframe-resizer** directory. From there it is automatically
  loaded into to meteor app which is hosting the iFrame.



    
