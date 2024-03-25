pipeline {
    agent {
        // Define agent details here
        node 
    }
    node {
        //checkout repo 
        checkout scm
    }
    
    stages {
        stage('Build') {
             steps {
                script {
                    sh 'npm install --fronzen-lockfile --verbose'
                    sh 'mkdir dist'
                    sh 'npm run dist '
                    sh 'cp dist/yellowbridge*/*  /opt/deployment/yellowbridge' 
                }
            }
        }
        stage('Stop and Run ') {
            steps {
                sh 'pm2 stop 0'
                sh 'pm2 start /opt/deployment/yellowbridge/app.min.js'
            }
        }
        stage('clean up'){
            always {
                echo 'One way or another, I have finished'
                //deleteDir() /* clean up our workspace */
            }
        }
    }
}